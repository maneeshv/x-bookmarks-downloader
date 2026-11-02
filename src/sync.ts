import {
  BACKFILL_MAX_ITEMS, BACKFILL_MAX_POSTERS, BACKFILL_MAX_REQUESTS, BACKFILL_PAGE_SIZE, DOWNLOAD_JITTER_MS, MAX_POSTER_BYTES, POST_ID_RE,
  MAX_DOWNLOADS_PER_RUN, PAGE_SIZE, PAUSE_MS_AUTH, REFRESH_AHEAD_MS, STALE_PARSER_RUNS, STORAGE_ALERT_BYTES, STORAGE_ALERT_STEP_BYTES, TWEET_LOOKUP_BATCH_SIZE,
} from "#src/limits";
import { posterKey, type BookmarkStatus, type BookmarkUpsert, type Store } from "#src/store";
import { fetchBookmarks, fetchTweetsByIds, parseBookmarks, refreshTokens, XApiError, type Fetch, type Item, type OAuthCfg, type Video } from "#src/x";

export type Cfg = OAuthCfg & { publicOrigin: string; telegram?: { token: string; chatId: string } };
export type Deps = { store: Store; fetch: Fetch; cfg: Cfg; now?: () => number; sleep?: (ms: number) => Promise<void>; random?: () => number };
export type SyncResult = {
  skipped?: "paused" | "needs_reauth"; error?: string; pages: number; seen: number; downloaded: number; failed: number; bytes: number;
  recorded?: number; queued?: number; // backfill only (ADR-0023): new rows recorded before downloading; live pending after the run
  durationBackfill?: { checked: number; updated: number; unavailable: number };
};
export type PosterResult = "stored" | "existing" | "unavailable" | "failed";
export type PosterBackfillResult = {
  postersStored: number; postersExisting: number; postersUnavailable: number; posterFailures: number; nextAfter: string | null;
};

const now = (d: Deps) => (d.now ?? Date.now)();
const iso = (ms: number) => new Date(ms).toISOString();

export async function alert(d: Deps, key: string, text: string): Promise<void> {
  const s = await d.store.getStatus();
  if (s.alerts?.[key]) return;
  if (d.cfg.telegram) {
    const { token, chatId } = d.cfg.telegram;
    // https://core.telegram.org/bots/api#sendmessage — send before marking, so a failed send is retried next time.
    let ok = false;
    try {
      ok = await d.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `x-downloader: ${text}` }),
      }).then((r) => r.ok);
    } catch { ok = false; }
    if (!ok) return;
  }
  await d.store.patchStatus({ alerts: { ...s.alerts, [key]: iso(now(d)) } });
}

export async function clearAlert(d: Deps, key: string): Promise<void> {
  const s = await d.store.getStatus();
  if (!s.alerts?.[key]) return;
  const { [key]: _, ...rest } = s.alerts;
  await d.store.patchStatus({ alerts: rest });
}

// Refresh tokens are single-use and rotate (docs/GOTCHAS.md): persist the new pair BEFORE using it; fall back to prevRefresh once.
export async function ensureAccessToken(d: Deps, force = false): Promise<string | null> {
  const t = await d.store.getTokens();
  if (!t) return null;
  if (!force && t.expiresAt - now(d) > REFRESH_AHEAD_MS) return t.access;
  for (const r of [t.refresh, t.prevRefresh]) {
    if (!r) continue;
    try {
      const nt = await refreshTokens(d.fetch, d.cfg, r, now(d));
      await d.store.putTokens(nt);
      return nt.access;
    } catch (e) {
      if (!(e instanceof XApiError) || e.status >= 500) throw e;
    }
  }
  return null;
}

async function needsReauth(d: Deps, res: SyncResult): Promise<SyncResult> {
  await d.store.patchStatus({ auth: "needs_reauth", lastError: "needs_reauth", lastRun: iso(now(d)) });
  await d.store.pause(now(d) + PAUSE_MS_AUTH);
  await alert(d, "needs_reauth", `re-authorize at ${d.cfg.publicOrigin}/oauth/start`);
  return { ...res, skipped: "needs_reauth" };
}

function row(it: Item, status: BookmarkStatus, d: Deps, extra: Partial<BookmarkUpsert> = {}): BookmarkUpsert {
  return {
    post_id: it.postId, posted_at: it.postedAt, text: it.text, post_url: it.postUrl, has_video: it.hasVideoMedia ? 1 : 0,
    status, error: null, r2_key: it.videos[0]?.key ?? null, bytes: null, duration_ms: it.videos[0]?.durationMs ?? null, preview_url: it.previewUrl, now: iso(now(d)), ...extra,
  };
}

// `bytes` on a failure = the Content-Length that was refused (too_large), so /stats can show it.
type Dl = { ok: true; bytes: number } | { ok: false; status: BookmarkStatus; error: string; bytes?: number };

async function download(d: Deps, it: Item, v: Video, maxFileBytes: number): Promise<Dl> {
  const res = await d.fetch(v.url);
  if (!res.ok || !res.body) return { ok: false, status: res.status >= 500 ? "pending" : "failed", error: `http_${res.status}` };
  const len = Number(res.headers.get("content-length")) || 0;
  // R2.put needs a known length for streams; an unknown/zero length is refused outright rather
  // than buffered, so a video response can never be read fully into memory before the size check.
  if (!len) return { ok: false, status: "failed", error: "no_length" };
  if (len > maxFileBytes) return { ok: false, status: "failed", error: "too_large", bytes: len };
  await d.store.putVideo(v.key, res.body, { postId: it.postId, text: it.text, postUrl: it.postUrl, postedAt: it.postedAt, previewUrl: it.previewUrl, bitRate: v.bitRate });
  return { ok: true, bytes: len };
}

export async function ensurePoster(d: Deps, postId: string, previewUrl: string | null): Promise<PosterResult> {
  if (!previewUrl) return "unavailable";
  const fail = (reason: string): PosterResult => { console.error("poster capture failed", postId, reason); return "failed"; };
  try {
    if (!POST_ID_RE.test(postId)) return fail("invalid_post_id");
    if (await d.store.has(posterKey(postId))) return "existing";
    const u = new URL(previewUrl);
    if (u.protocol !== "https:" || u.hostname !== "pbs.twimg.com" || u.username || u.password || u.port) return fail("invalid_url");
    const res = await d.fetch(u.toString(), { redirect: "manual" });
    if (!res.ok || !res.body) return fail(`http_${res.status}`);
    const len = Number(res.headers.get("content-length")) || 0;
    if (!Number.isSafeInteger(len) || len <= 0 || len > MAX_POSTER_BYTES) return fail(len > MAX_POSTER_BYTES ? "too_large" : "no_length");
    const contentType = res.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "image/jpeg" && contentType !== "image/png" && contentType !== "image/webp") return fail("bad_type");
    return await d.store.putPoster(postId, res.body, contentType) ? "stored" : "existing";
  } catch (e) {
    return fail(e instanceof Error ? e.name : "exception");
  }
}

export async function backfillPosters(d: Deps, limit: number, after: string | null): Promise<PosterBackfillResult> {
  const candidates = await d.store.listPosterSources(after, limit + 1);
  const rows = candidates.slice(0, limit);
  const out: PosterBackfillResult = { postersStored: 0, postersExisting: 0, postersUnavailable: 0, posterFailures: 0, nextAfter: candidates.length > limit ? rows.at(-1)!.post_id : null };
  for (const row of rows) {
    let result: PosterResult = "unavailable";
    try {
      if (row.r2_key && await d.store.has(row.r2_key)) result = await ensurePoster(d, row.post_id, row.preview_url);
    } catch (e) {
      console.error("poster backfill failed", row.post_id, e instanceof Error ? e.name : "exception");
      result = "failed";
    }
    if (result === "stored") out.postersStored++;
    else if (result === "existing") out.postersExisting++;
    else if (result === "unavailable") out.postersUnavailable++;
    else out.posterFailures++;
  }
  return out;
}

async function capturePoster(d: Deps, it: Item, budget: { posters: number }): Promise<void> {
  if (budget.posters >= BACKFILL_MAX_POSTERS) return;
  budget.posters++;
  await ensurePoster(d, it.postId, it.previewUrl);
}

async function processItem(d: Deps, it: Item, res: SyncResult, budget: { downloads: number; max: number; posters: number }, maxFileBytes: number): Promise<void> {
  if (!it.hasVideoMedia) return d.store.upsertBookmark(row(it, "no_video", d));
  // A row with a permanent error — outright "failed", or "downloaded" partial (one video of a
  // multi-video post permanently failed) — is not retried unless the error is transient
  // (http_5xx); "pending" rows (budget-deferred or transient failures) always retry.
  const prev = await d.store.getBookmark(it.postId);
  // Owner deleted it (ADR-0011): the tombstone overrides the R2 ledger — never re-download.
  if (prev?.deleted_at) return;
  if (prev && prev.status !== "pending" && prev.error && !prev.error.startsWith("http_5")) {
    if (prev.status === "downloaded" && prev.r2_key && await d.store.has(prev.r2_key)) await capturePoster(d, it, budget);
    return;
  }
  if (it.videos.length === 0) { res.failed++; return d.store.upsertBookmark(row(it, "failed", d, { error: "no_variants" })); }
  let bytes = 0, stored = 0, fail: Dl | null = null, firstStoredKey: string | null = null;
  for (const v of it.videos) {
    const head = await d.store.r2.head(v.key);
    if (head) { bytes += head.size; stored++; firstStoredKey ??= v.key; continue; }
    if (budget.downloads >= budget.max) continue;
    budget.downloads++;
    let r: Dl;
    try { r = await download(d, it, v, maxFileBytes); } catch (e) { console.error("download failed", v.key, String(e)); r = { ok: false, status: "pending", error: "exception" }; }
    if (r.ok) { bytes += r.bytes; stored++; firstStoredKey ??= v.key; res.downloaded++; res.bytes += r.bytes; }
    else { fail = r; res.failed++; }
    const [lo, hi] = DOWNLOAD_JITTER_MS;
    await (d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(lo + (d.random ?? Math.random)() * (hi - lo));
  }
  // r2_key must point at a video actually in R2 (index/video route serve straight from it) —
  // it.videos[0] is wrong whenever the first video is the one that permanently failed.
  const duration_ms = it.videos.find((v) => v.key === firstStoredKey)?.durationMs ?? null;
  if (stored > 0) await capturePoster(d, it, budget);
  if (stored === it.videos.length) return d.store.upsertBookmark(row(it, "downloaded", d, { bytes, r2_key: firstStoredKey, duration_ms }));
  // Partial: at least one video of a multi-video post is stored and the rest can never succeed —
  // record it as downloaded (with the failing video's error) instead of hiding the stored sibling
  // behind a "pending"/"failed" row that never lists it.
  if (stored > 0 && fail && !fail.ok && fail.status === "failed") return d.store.upsertBookmark(row(it, "downloaded", d, { bytes, r2_key: firstStoredKey, duration_ms, error: fail.error }));
  if (fail && !fail.ok) return d.store.upsertBookmark(row(it, fail.status, d, { error: fail.error, bytes: fail.bytes ?? null }));
  return d.store.upsertBookmark(row(it, "pending", d));
}

async function breaker(d: Deps, e: XApiError, res: SyncResult): Promise<SyncResult> {
  const t = now(d);
  // Fold bytes downloaded before the failure into totalBytes first, so every exit path
  // below (including needsReauth's early return on a dead 401) accounts for them.
  const s = await d.store.getStatus();
  await d.store.patchStatus({ totalBytes: (s.totalBytes ?? 0) + res.bytes });
  if (e.status === 401) {
    const access = await ensureAccessToken(d, true);
    if (!access) return needsReauth(d, res);
  } else if (e.status === 429) {
    await d.store.pause(e.rateLimitReset ? e.rateLimitReset * 1000 : t + 15 * 60_000);
    await alert(d, "api_429", `rate limited, paused until ${iso(await d.store.getPausedUntil())}`);
  } else if (e.status === 403) {
    await d.store.pause(t + PAUSE_MS_AUTH);
    await alert(d, "api_403", `403 from X on ${e.path}; paused 24h. Check console.x.com credits/app.`);
  }
  await d.store.patchStatus({ lastRun: iso(t), lastError: e.message });
  return { ...res, error: e.message };
}

export async function sync(d: Deps, o: { backfill?: boolean; maxDownloads?: number; durations?: boolean } = {}): Promise<SyncResult> {
  const res: SyncResult = { pages: 0, seen: 0, downloaded: 0, failed: 0, bytes: 0 };
  if ((await d.store.getPausedUntil()) > now(d)) return { ...res, skipped: "paused" };

  let paginationToken: string | undefined, resultCount = 0, sawMedia = false;
  try {
    const access = await ensureAccessToken(d);
    if (!access) return needsReauth(d, res);

    if (o.durations) {
      const missing = await d.store.listMissingDurations(BACKFILL_MAX_ITEMS);
      let updated = 0;
      for (let i = 0; i < missing.length; i += TWEET_LOOKUP_BATCH_SIZE) {
        const batch = missing.slice(i, i + TWEET_LOOKUP_BATCH_SIZE);
        const items = parseBookmarks(await fetchTweetsByIds(d.fetch, access, batch.map((r) => r.post_id)));
        const byId = new Map(items.map((it) => [it.postId, it]));
        res.pages++;
        res.seen += items.length;
        for (const row of batch) {
          const durationMs = byId.get(row.post_id)?.videos.find((v) => v.key === row.r2_key)?.durationMs;
          if (durationMs != null && await d.store.updateDuration(row.post_id, row.r2_key, durationMs)) updated++;
        }
      }
      res.durationBackfill = { checked: missing.length, updated, unavailable: missing.length - updated };
      await d.store.patchStatus({ lastRun: iso(now(d)), lastError: null, auth: "ok" });
      for (const k of ["needs_reauth", "api_403", "api_429"]) await clearAlert(d, k);
      return res;
    }

    const userId = await d.store.getUserId();
    if (!userId) return needsReauth(d, res);
    const maxFileBytes = await d.store.getMaxFileBytes();
    const maxPages = o.backfill ? BACKFILL_MAX_REQUESTS : 1;
    const pageSize = o.backfill ? BACKFILL_PAGE_SIZE : PAGE_SIZE;
    const budget = { downloads: 0, max: o.maxDownloads ?? MAX_DOWNLOADS_PER_RUN, posters: 0 };
    const hydratedPendingIds = new Set<string>();
    const pendingIds = await d.store.listPendingIds(TWEET_LOOKUP_BATCH_SIZE);
    const hydratePending = async (ids: string[]) => {
      if (ids.length === 0) return;
      for (const it of parseBookmarks(await fetchTweetsByIds(d.fetch, access, ids))) {
        hydratedPendingIds.add(it.postId);
        await processItem(d, it, res, budget, maxFileBytes);
      }
    };

    if (o.backfill) {
      // ADR-0023: record every bookmark before downloading anything, so a request canceled mid-download
      // (client disconnect) cannot lose bookmarks the run had read but not yet reached.
      res.recorded = 0;
      const seen: Item[] = [];
      for (let page = 0; page < maxPages; page++) {
        const body = await fetchBookmarks(d.fetch, access, userId, { maxResults: pageSize, paginationToken });
        res.pages++;
        resultCount += body.meta?.result_count ?? 0;
        const items = parseBookmarks(body);
        res.seen += items.length;
        for (const it of items) {
          sawMedia ||= it.hasVideoMedia;
          if (!it.hasVideoMedia) await d.store.upsertBookmark(row(it, "no_video", d));
          else { seen.push(it); if (await d.store.recordSeen(row(it, "pending", d))) res.recorded++; }
        }
        paginationToken = body.meta?.next_token;
        if (!paginationToken || res.seen >= BACKFILL_MAX_ITEMS) break;
      }
      // Pages already carry fresh media URLs for what they returned; look up only older pending rows they did not.
      const seenIds = new Set(seen.map((it) => it.postId));
      await hydratePending(pendingIds.filter((id) => !seenIds.has(id)));
      // Only rows still pending: downloaded rows are not re-checked here (the cron's newest page reconciles them).
      for (const it of seen) {
        if (!hydratedPendingIds.has(it.postId) && (await d.store.getBookmark(it.postId))?.status === "pending") await processItem(d, it, res, budget, maxFileBytes);
      }
      res.queued = (await d.store.countQueue()).pending;
    } else {
      await hydratePending(pendingIds);
      for (let page = 0; page < maxPages; page++) {
        const body = await fetchBookmarks(d.fetch, access, userId, { maxResults: pageSize, paginationToken });
        res.pages++;
        resultCount += body.meta?.result_count ?? 0;
        const items = parseBookmarks(body);
        res.seen += items.length;
        for (const it of items) {
          sawMedia ||= it.hasVideoMedia;
          if (!hydratedPendingIds.has(it.postId)) await processItem(d, it, res, budget, maxFileBytes);
        }
        paginationToken = body.meta?.next_token;
        if (!paginationToken || res.seen >= BACKFILL_MAX_ITEMS) break;
      }
    }
  } catch (e) {
    if (e instanceof XApiError) return breaker(d, e, res);
    await d.store.patchStatus({ lastRun: iso(now(d)), lastError: String(e) });
    // no tokens can be in `e` from our code paths (all XApiErrors are handled above).
    console.error("sync failed", String(e));
    throw e;
  }

  const s = await d.store.getStatus();
  const noMediaRuns = resultCount > 0 && !sawMedia ? (s.noMediaRuns ?? 0) + 1 : 0;
  if (noMediaRuns >= STALE_PARSER_RUNS) await alert(d, "stale_parser", `${noMediaRuns} runs with bookmarks but zero media — parser may be stale`);
  const totalBytes = (s.totalBytes ?? 0) + res.bytes;
  // One alert per STORAGE_ALERT_STEP_BYTES step crossed (key "storage:12GB"); every other storage key is dropped,
  // so a decrease (delete) below a step re-arms it, and the pre-2026-08-31 one-shot "storage" key retires itself.
  const stepGB = Math.floor(totalBytes / STORAGE_ALERT_STEP_BYTES) * STORAGE_ALERT_STEP_BYTES / 1024 ** 3;
  for (const k of Object.keys(s.alerts ?? {})) if (k.startsWith("storage") && k !== `storage:${stepGB}GB`) await clearAlert(d, k);
  if (totalBytes > STORAGE_ALERT_BYTES) await alert(d, `storage:${stepGB}GB`, `stored ${(totalBytes / 1024 ** 3).toFixed(2)} GB (> ${stepGB} GB)`);
  await d.store.patchStatus({
    lastRun: iso(now(d)), lastError: null, auth: "ok", totalBytes, noMediaRuns,
    counts: { seen: res.seen, downloaded: res.downloaded, failed: res.failed, pages: res.pages },
  });
  for (const k of ["needs_reauth", "api_403", "api_429"]) await clearAlert(d, k);
  return res;
}
