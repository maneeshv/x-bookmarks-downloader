import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "#src/store";
import { backfillPosters, ensurePoster, sync, type Deps } from "#src/sync";
import { DEFAULT_MAX_FILE_BYTES, MAX_DOWNLOADS_PER_RUN, MAX_FILE_BYTES, MAX_POSTER_BYTES, MIN_FILE_BYTES, STORAGE_ALERT_STEP_BYTES } from "#src/limits";
import { FakeD1, FakeKV, FakeR2, fakeFetch, fixture, type Scripted } from "./fakes.ts";

const fx = () => fixture("bookmarks.json");
const NOW = 1_700_000_000_000;
const mp4 = (n = 3): Scripted => ({ status: 200, bodyBytes: new Uint8Array(n), headers: { "content-type": "video/mp4", "content-length": String(n) } });
const jpeg = (): Scripted => ({ status: 200, bodyBytes: new Uint8Array([0xff, 0xd8]), headers: { "content-type": "image/jpeg", "content-length": "2" } });

function world(routes: (url: string, init: RequestInit) => Scripted, over: Partial<Deps> = {}) {
  const kv = new FakeKV(), r2 = new FakeR2(), d1 = new FakeD1();
  const store = new Store(kv.asKV(), d1.asD1(), r2.asR2());
  const f = fakeFetch(routes);
  const d: Deps = {
    store, fetch: f, now: () => NOW, sleep: async () => {}, random: () => 0,
    cfg: { clientId: "c", clientSecret: "s", redirectUri: "https://w/oauth/callback", publicOrigin: "https://w", telegram: { token: "T", chatId: "C" } },
    ...over,
  };
  return { kv, r2, d1, store, f, d };
}
const authed = async (store: Store, expiresAt = NOW + 3600_000) => {
  await store.putTokens({ access: "A", refresh: "R", expiresAt }); await store.putUserId("u1");
};
const routes = (bookmarks: unknown, video: (url: string) => Scripted = () => mp4()) => (url: string): Scripted => {
  if (url.includes("/tweets?")) {
    const ids = new Set(new URL(url).searchParams.get("ids")?.split(","));
    const body = bookmarks as { data?: { id: string }[] };
    return { status: 200, body: { ...body, data: body.data?.filter((t) => ids.has(t.id)) } };
  }
  if (url.includes("/bookmarks")) return { status: 200, body: bookmarks };
  if (url.includes("api.telegram.org")) return { status: 200, body: { ok: true } };
  if (url.includes("oauth2/token")) return { status: 200, body: { access_token: "A2", refresh_token: "R2", expires_in: 7200 } };
  if (url.includes("pbs.twimg.com")) return jpeg();
  return video(url);
};

test("happy path: records every bookmark, downloads every video, reconciles on rerun", async () => {
  const w = world(routes(fx())); await authed(w.store);
  const r = await sync(w.d);
  assert.deepEqual(r, { pages: 1, seen: 6, downloaded: 4, failed: 1, bytes: 12 });
  assert.deepEqual([...w.r2.objects.keys()].sort(), [
    "1000000000000000001.mp4", "1000000000000000002.mp4", "1000000000000000004-1.mp4", "1000000000000000004-2.mp4",
    "posters/1000000000000000001", "posters/1000000000000000002", "posters/1000000000000000004",
  ]);
  const st = async (id: string) => (await w.store.getBookmark(id))!;
  assert.equal((await st("1000000000000000001")).status, "downloaded");
  assert.equal((await st("1000000000000000001")).r2_key, "1000000000000000001.mp4");
  assert.equal((await st("1000000000000000003")).status, "no_video");
  assert.equal((await st("1000000000000000004")).bytes, 6);
  assert.deepEqual([(await st("1000000000000000005")).status, (await st("1000000000000000005")).error], ["failed", "no_variants"]);
  assert.equal((await st("1000000000000000006")).status, "no_video");
  const s = await w.store.getStatus();
  assert.equal(s.auth, "ok"); assert.equal(s.totalBytes, 12); assert.equal(s.lastError, null);
  const r2 = await sync(w.d);
  assert.equal(r2.downloaded, 0); assert.equal(r2.seen, 6);
  assert.equal(w.f.calls.filter(([u]) => u.includes("video.twimg")).length, 4, "no re-download");
  assert.equal(w.f.calls.filter(([u]) => u.includes("pbs.twimg.com")).length, 3, "existing posters are not refetched");
});

test("poster capture rejects unsafe or invalid responses without touching R2", async () => {
  const cases: [string, string, Scripted][] = [
    ["invalid host", "https://example.com/p.jpg", jpeg()],
    ["non-HTTPS", "http://pbs.twimg.com/p.jpg", jpeg()],
    ["credentials", "https://user:pass@pbs.twimg.com/p.jpg", jpeg()],
    ["custom port", "https://pbs.twimg.com:444/p.jpg", jpeg()],
    ["redirect", "https://pbs.twimg.com/redirect", { status: 302, headers: { location: "https://example.com/p.jpg" } }],
    ["missing length", "https://pbs.twimg.com/no-length", { status: 200, bodyBytes: new Uint8Array([1]), headers: { "content-type": "image/jpeg" } }],
    ["oversized", "https://pbs.twimg.com/huge", { ...jpeg(), headers: { "content-type": "image/jpeg", "content-length": String(MAX_POSTER_BYTES + 1) } }],
    ["wrong type", "https://pbs.twimg.com/not-image", mp4()],
  ];
  for (const [name, url, response] of cases) {
    const w = world(() => response);
    assert.equal(await ensurePoster(w.d, "12345", url), "failed", name);
    assert.equal(w.r2.objects.size, 0, name);
  }
});

test("poster backfill advances its D1 cursor past failures and is idempotent", async () => {
  const w = world((url) => url.endsWith("/a.jpg") ? { status: 404 } : jpeg());
  for (const [post_id, image] of [["11111", "a"], ["22222", "b"], ["33333", "c"]]) {
    await w.store.upsertBookmark({
      post_id, posted_at: null, text: null, post_url: `https://x.com/i/status/${post_id}`, has_video: 1,
      status: "downloaded", error: null, r2_key: `${post_id}.mp4`, bytes: 1, duration_ms: null,
      preview_url: `https://pbs.twimg.com/${image}.jpg`, now: "2026-09-02T00:00:00Z",
    });
    await w.r2.put(`${post_id}.mp4`, new Uint8Array([1]));
  }
  const first = await backfillPosters(w.d, 2, null);
  assert.deepEqual(first, { postersStored: 1, postersExisting: 0, postersUnavailable: 0, posterFailures: 1, nextAfter: "22222" });
  assert.deepEqual(await backfillPosters(w.d, 2, first.nextAfter), { postersStored: 1, postersExisting: 0, postersUnavailable: 0, posterFailures: 0, nextAfter: null });
  assert.deepEqual(await backfillPosters(w.d, 2, "22222"), { postersStored: 0, postersExisting: 1, postersUnavailable: 0, posterFailures: 0, nextAfter: null });
  assert.deepEqual(await backfillPosters(w.d, 3, null), { postersStored: 0, postersExisting: 2, postersUnavailable: 0, posterFailures: 1, nextAfter: null });
});

test("poster fetch failure leaves the downloaded video available", async () => {
  const b = fx(); b.data = b.data.slice(0, 1); b.meta.result_count = 1;
  const w = world((url) => {
    if (url.includes("/bookmarks")) return { status: 200, body: b };
    if (url.includes("pbs.twimg.com")) throw new Error("poster unavailable");
    return mp4();
  });
  await authed(w.store);
  assert.equal((await sync(w.d)).downloaded, 1);
  assert.equal((await w.store.getBookmark("1000000000000000001"))?.status, "downloaded");
  assert.ok(w.r2.objects.has("1000000000000000001.mp4"));
  assert.equal(w.r2.objects.has("posters/1000000000000000001"), false);
});

test("ordinary multi-page backfill caps poster capture attempts at 30", async () => {
  const b = fx();
  b.data = Array.from({ length: 31 }, (_, i) => ({ id: `30000000000000000${String(i).padStart(2, "0")}`, text: "v", attachments: { media_keys: [`13_${i}`] } }));
  b.includes.media = b.data.map((t: { id: string }, i: number) => ({ media_key: `13_${i}`, type: "video", preview_image_url: `https://pbs.twimg.com/${i}.jpg`, variants: [{ bit_rate: 1, content_type: "video/mp4", url: `https://video.twimg.com/${t.id}.mp4` }] }));
  delete b.meta.next_token; b.meta.result_count = 31;
  const w = world(routes(b)); await authed(w.store);
  for (const t of b.data) await w.r2.put(`${t.id}.mp4`, new Uint8Array([1]));
  await sync(w.d, { backfill: true });
  assert.equal(w.f.calls.filter(([u]) => u.includes("pbs.twimg.com")).length, 30);
});

test("download cap leaves the rest pending; next run picks them up", async () => {
  const b = fx();
  b.data = Array.from({ length: 7 }, (_, i) => ({ id: `20000000000000000${i}`, text: `v${i}`, attachments: { media_keys: [`13_${i}`] } }));
  b.includes.media = b.data.map((t: { id: string }, i: number) => ({ media_key: `13_${i}`, type: "video", variants: [{ bit_rate: 1, content_type: "video/mp4", url: `https://video.twimg.com/${t.id}.mp4` }] }));
  const w = world(routes(b)); await authed(w.store);
  const r1 = await sync(w.d);
  assert.equal(r1.downloaded, MAX_DOWNLOADS_PER_RUN);
  assert.equal((await w.store.getBookmark("200000000000000006"))?.status, "pending");
  const r2 = await sync(w.d);
  assert.equal(r2.downloaded, 2);
  assert.equal((await w.store.listLibrary()).length, 7);
});

test("pending D1 rows are hydrated directly even when absent from bookmarks", async () => {
  const source = fx(), foundId = "1000000000000000001";
  const missingIds = Array.from({ length: MAX_DOWNLOADS_PER_RUN }, (_, i) => `999999999999999999${i}`);
  const lookup = {
    data: source.data.filter((t: { id: string }) => t.id === foundId),
    includes: source.includes,
    meta: { result_count: 1 },
  };
  const empty = { data: [], includes: { media: [] }, meta: { result_count: 0 } };
  const w = world((url) => {
    if (url.includes("/tweets?")) return { status: 200, body: lookup };
    if (url.includes("/bookmarks")) return { status: 200, body: empty };
    return mp4();
  });
  const pendingIds = [...missingIds, foundId];
  for (const [i, post_id] of pendingIds.entries()) {
    await w.store.upsertBookmark({
      post_id, posted_at: null, text: null, post_url: `https://x.com/i/status/${post_id}`, has_video: 1,
      status: "pending", error: null, r2_key: `${post_id}.mp4`, bytes: null, duration_ms: null, preview_url: null,
      now: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    });
  }
  await authed(w.store);

  const r = await sync(w.d);

  assert.deepEqual(r, { pages: 1, seen: 0, downloaded: 1, failed: 0, bytes: 3 });
  assert.equal((await w.store.getBookmark(foundId))?.status, "downloaded");
  assert.equal((await w.store.getBookmark(missingIds[0]!))?.status, "pending", "an omitted post is not terminalized");
  const lookups = w.f.calls.filter(([url]) => url.includes("/tweets?"));
  assert.equal(lookups.length, 1);
  assert.equal(new URL(lookups[0]![0]).searchParams.get("ids"), pendingIds.join(","));
});

test("paused → skipped without any API call", async () => {
  const w = world(routes(fx())); await authed(w.store); await w.store.pause(NOW + 1);
  assert.equal((await sync(w.d)).skipped, "paused");
  assert.equal(w.f.calls.length, 0);
});

test("token near expiry is refreshed and persisted before use; prevRefresh used when current fails", async () => {
  let tokenCalls = 0;
  const w = world((url, init) => {
    if (url.includes("oauth2/token")) {
      tokenCalls++;
      const rt = new URLSearchParams(init.body as string).get("refresh_token");
      return rt === "R" ? { status: 400, body: {} } : { status: 200, body: { access_token: "A2", refresh_token: "R2", expires_in: 7200 } };
    }
    return routes(fx())(url);
  });
  await w.store.putTokens({ access: "A", refresh: "R", prevRefresh: "Rprev", expiresAt: NOW + 60_000 }); await w.store.putUserId("u1");
  const r = await sync(w.d);
  assert.equal(r.seen, 6);
  assert.equal(tokenCalls, 2);
  assert.deepEqual(await w.store.getTokens(), { access: "A2", refresh: "R2", prevRefresh: "Rprev", expiresAt: NOW + 7200_000 });
  assert.equal((w.f.calls.find(([u]) => u.includes("/bookmarks"))![1].headers as Record<string, string>).Authorization, "Bearer A2");
});

test("both refresh tokens rejected → needs_reauth, paused, one Telegram alert", async () => {
  const w = world((url) => (url.includes("oauth2/token") ? { status: 400, body: {} } : routes(fx())(url)));
  await w.store.putTokens({ access: "A", refresh: "R", prevRefresh: "P", expiresAt: NOW }); await w.store.putUserId("u1");
  assert.equal((await sync(w.d)).skipped, "needs_reauth");
  assert.equal((await w.store.getStatus()).auth, "needs_reauth");
  assert.ok((await w.store.getPausedUntil()) > NOW);
  const tg = () => w.f.calls.filter(([u]) => u.includes("api.telegram.org"));
  assert.equal(tg().length, 1);
  assert.match(tg()[0][1].body as string, /https:\/\/w\/oauth\/start/);
  await w.store.clearPause();
  await sync(w.d);
  assert.equal(tg().length, 1, "alert not repeated while condition persists");
});

test("429 pauses until x-rate-limit-reset and alerts; 403 pauses 24h", async () => {
  const w = world((url) => (url.includes("/bookmarks") ? { status: 429, body: {}, headers: { "x-rate-limit-reset": String(NOW / 1000 + 900) } } : routes(fx())(url)));
  await authed(w.store);
  const r = await sync(w.d);
  assert.match(r.error!, /429/);
  assert.equal(await w.store.getPausedUntil(), NOW + 900_000);
  assert.equal((await w.store.getStatus()).alerts?.api_429 !== undefined, true);
  const w2 = world((url) => (url.includes("/bookmarks") ? { status: 403, body: {} } : routes(fx())(url)));
  await authed(w2.store); await sync(w2.d);
  assert.equal(await w2.store.getPausedUntil(), NOW + 24 * 3600_000);
});

test("video too large → failed/too_large, nothing stored; 5xx → pending/http_503", async () => {
  const b = fx(); b.data = b.data.slice(0, 2); b.meta.result_count = 2;
  const w = world(routes(b, (url) => (url.includes("1_high") ? { status: 200, bodyBytes: new Uint8Array(1), headers: { "content-length": String(MAX_FILE_BYTES + 1) } } : { status: 503 })));
  await authed(w.store);
  const r = await sync(w.d);
  assert.equal(r.downloaded, 0); assert.equal(r.failed, 2); assert.equal(w.r2.objects.size, 0);
  assert.deepEqual([(await w.store.getBookmark("1000000000000000001"))!.status, (await w.store.getBookmark("1000000000000000001"))!.error], ["failed", "too_large"]);
  assert.equal((await w.store.getBookmark("1000000000000000001"))!.bytes, MAX_FILE_BYTES + 1, "too_large records the size it refused");
  assert.deepEqual([(await w.store.getBookmark("1000000000000000002"))!.status, (await w.store.getBookmark("1000000000000000002"))!.error], ["pending", "http_503"]);

  // permanently failed (too_large) must not be retried; transiently failed (http_503) must be
  const highCallsBefore = w.f.calls.filter(([u]) => u.includes("1_high")).length;
  const gifCallsBefore = w.f.calls.filter(([u]) => u.includes("/2.mp4")).length;
  const r2 = await sync(w.d);
  assert.equal(r2.downloaded, 0);
  assert.equal(w.f.calls.filter(([u]) => u.includes("1_high")).length, highCallsBefore, "permanently failed item not re-fetched");
  assert.equal(w.f.calls.filter(([u]) => u.includes("/2.mp4")).length, gifCallsBefore + 1, "transient failure is retried");
  assert.deepEqual([(await w.store.getBookmark("1000000000000000001"))!.status, (await w.store.getBookmark("1000000000000000001"))!.error], ["failed", "too_large"]);
});

test("sync snapshots the owner-selected max file bytes once per run", async () => {
  const b = fx(); b.data = b.data.slice(0, 2); b.meta.result_count = 2;
  let kv: FakeKV;
  const w = world(routes(b, () => {
    kv.map.set("max_file_bytes", String(MAX_FILE_BYTES));
    return { status: 200, bodyBytes: new Uint8Array(1), headers: { "content-length": String(2 * MIN_FILE_BYTES) } };
  }));
  kv = w.kv;
  await w.store.putMaxFileBytes(MIN_FILE_BYTES);
  await authed(w.store);
  const r = await sync(w.d);
  assert.equal(r.downloaded, 0);
  assert.equal(r.failed, 2);
  assert.equal(w.r2.objects.size, 0, "both videos use the 1 MiB snapshot even after KV changes to 5 GiB");
  assert.deepEqual((await w.store.listByStatus(["failed"])).map((x) => x.error), ["too_large", "too_large"]);
});

test("an owner-selected limit above the default permits a larger video", async () => {
  const b = fx(); b.data = b.data.slice(0, 1); b.meta.result_count = 1;
  const len = DEFAULT_MAX_FILE_BYTES + 1;
  const w = world(routes(b, () => ({ status: 200, bodyBytes: new Uint8Array(1), headers: { "content-length": String(len) } })));
  await w.store.putMaxFileBytes(2 * DEFAULT_MAX_FILE_BYTES);
  await authed(w.store);
  const r = await sync(w.d);
  assert.equal(r.downloaded, 1);
  assert.equal(r.failed, 0);
  assert.equal((await w.store.getBookmark("1000000000000000001"))!.status, "downloaded");
});

test("video response with no content-length → failed/no_length, nothing stored, body never read", async () => {
  const b = fx(); b.data = b.data.slice(0, 1); b.meta.result_count = 1;
  const w = world(routes(b, () => ({ status: 200, bodyBytes: new Uint8Array(3), headers: { "content-type": "video/mp4" } })));
  await authed(w.store);
  const r = await sync(w.d);
  assert.equal(r.downloaded, 0); assert.equal(r.failed, 1);
  assert.equal(w.r2.objects.size, 0, "no_length is refused before anything is stored");
  const row = await w.store.getBookmark("1000000000000000001");
  assert.deepEqual([row!.status, row!.error], ["failed", "no_length"]);
});

test("multi-video post with one permanently failed video: the stored sibling is not hidden (partial)", async () => {
  const b = fx(); b.data = b.data.slice(3, 4); b.meta.result_count = 1;
  const w = world(routes(b, (url) => (url.includes("4b.mp4") ? { status: 404, body: {} } : mp4())));
  await authed(w.store);
  const r = await sync(w.d);
  assert.equal(r.downloaded, 1); assert.equal(r.failed, 1);
  const row = await w.store.getBookmark("1000000000000000004");
  assert.deepEqual([row!.status, row!.error, row!.r2_key], ["downloaded", "http_404", "1000000000000000004-1.mp4"]);
  assert.deepEqual([...w.r2.objects.keys()], ["1000000000000000004-1.mp4", "posters/1000000000000000004"]);
  assert.ok((await w.store.listLibrary()).some((x) => x.post_id === "1000000000000000004"), "listLibrary includes the partial row");

  const videoCalls = () => w.f.calls.filter(([u]) => u.includes("4a.mp4") || u.includes("4b.mp4")).length;
  await w.r2.delete("posters/1000000000000000004");
  const before = videoCalls();
  const r2 = await sync(w.d);
  assert.equal(r2.downloaded, 0); assert.equal(r2.failed, 0);
  assert.equal(videoCalls(), before, "neither video is refetched on rerun");
  assert.ok(w.r2.objects.has("posters/1000000000000000004"), "the permanent-error fast path repairs its poster");
});

test("multi-video post where the FIRST video permanently fails: r2_key points at the stored (second) key", async () => {
  const b = fx(); b.data = b.data.slice(3, 4); b.meta.result_count = 1;
  const w = world(routes(b, (url) => (url.includes("4a.mp4") ? { status: 404, body: {} } : mp4())));
  await authed(w.store);
  const r = await sync(w.d);
  assert.equal(r.downloaded, 1); assert.equal(r.failed, 1);
  const row = await w.store.getBookmark("1000000000000000004");
  assert.deepEqual([row!.status, row!.error, row!.r2_key], ["downloaded", "http_404", "1000000000000000004-2.mp4"]);
  assert.equal(row!.duration_ms, 90000, "duration belongs to the stored second video");
  assert.ok(w.r2.objects.has("1000000000000000004-2.mp4"), "the stored key is actually in R2");
  assert.equal(w.r2.objects.has("1000000000000000004-1.mp4"), false);
});

test("non-XApiError throw during download does not abort the run", async () => {
  const b = fx(); b.data = b.data.slice(0, 2); b.meta.result_count = 2;
  const w = world(routes(b, (url) => {
    if (url.includes("1_high")) throw new Error("boom");
    return mp4();
  }));
  await authed(w.store);
  const r = await sync(w.d);
  assert.equal(r.downloaded, 1); assert.equal(r.failed, 1);
  const st1 = await w.store.getBookmark("1000000000000000001");
  assert.deepEqual([st1!.status, st1!.error], ["pending", "exception"]);
  assert.equal((await w.store.getBookmark("1000000000000000002"))!.status, "downloaded");
  assert.ok((await w.store.getStatus()).lastRun);
});

// A backfill reads every page before downloading (ADR-0023), so bytes-before-failure is exercised on the
// cron path: the pending lookup downloads first, then the bookmarks page fails.
const pendingThenBookmarks = async (bookmarks: () => Scripted, over: (url: string) => Scripted | null = () => null) => {
  const w = world((url) => {
    const o = over(url); if (o) return o;
    if (url.includes("/bookmarks")) return bookmarks();
    return routes(fx())(url);
  });
  await w.store.upsertBookmark({
    post_id: "1000000000000000001", posted_at: null, text: null, post_url: "https://x.com/i/status/1000000000000000001", has_video: 1,
    status: "pending", error: null, r2_key: null, bytes: null, duration_ms: null, preview_url: null, now: "2026-08-01T00:00:00Z",
  });
  await authed(w.store);
  return w;
};

test("breaker preserves bytes downloaded before the failure", async () => {
  const w = await pendingThenBookmarks(() => ({ status: 429, body: {}, headers: { "x-rate-limit-reset": String(NOW / 1000 + 900) } }));
  const r = await sync(w.d);
  assert.ok(r.bytes > 0);
  assert.equal((await w.store.getStatus()).totalBytes, r.bytes);
});

test("breaker preserves bytes before needs_reauth on a dead 401", async () => {
  const w = await pendingThenBookmarks(() => ({ status: 401, body: {} }), (url) => url.includes("oauth2/token") ? { status: 400, body: {} } : null);
  const r = await sync(w.d);
  assert.equal(r.skipped, "needs_reauth");
  const s = await w.store.getStatus();
  assert.equal(s.totalBytes, r.bytes);
  assert.ok(s.totalBytes! > 0);
  assert.equal(s.auth, "needs_reauth");
});

test("alert retries the Telegram send until it succeeds before marking the key", async () => {
  let tgCalls = 0;
  const w = world((url) => {
    if (url.includes("api.telegram.org")) { tgCalls++; return { status: tgCalls === 1 ? 500 : 200, body: {} }; }
    if (url.includes("oauth2/token")) return { status: 400, body: {} };
    return routes(fx())(url);
  });
  await w.store.putTokens({ access: "A", refresh: "R", prevRefresh: "P", expiresAt: NOW }); await w.store.putUserId("u1");
  await sync(w.d);
  assert.equal((await w.store.getStatus()).alerts?.needs_reauth, undefined, "not marked when send failed");
  await w.store.clearPause();
  await sync(w.d);
  assert.equal(tgCalls, 2);
  assert.ok((await w.store.getStatus()).alerts?.needs_reauth, "marked once send succeeds");
});

test("backfill paginates with max_results=90 until no next_token", async () => {
  let page = 0;
  const w = world((url) => {
    if (url.includes("/bookmarks")) { page++; const b = fx(); if (page === 2) delete b.meta.next_token; return { status: 200, body: b }; }
    return routes(fx())(url);
  });
  await authed(w.store);
  const r = await sync(w.d, { backfill: true });
  assert.equal(r.pages, 2); assert.equal(r.seen, 12);
  assert.equal(new URL(w.f.calls[0][0]).searchParams.get("max_results"), "90");
  assert.equal(new URL(w.f.calls.filter(([u]) => u.includes("/bookmarks"))[1][0]).searchParams.get("pagination_token"), "abc");
});

const pageOf = (ids: string[], next?: string) => ({
  data: ids.map((id, i) => ({ id, text: `v${id}`, attachments: { media_keys: [`13_${id}`] } })),
  includes: { media: ids.map((id) => ({ media_key: `13_${id}`, type: "video", preview_image_url: `https://pbs.twimg.com/${id}.jpg`, variants: [{ bit_rate: 1, content_type: "video/mp4", url: `https://video.twimg.com/${id}.mp4` }] })) },
  meta: { result_count: ids.length, ...(next ? { next_token: next } : {}) },
});
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")}`);

test("backfill records every bookmark on every page before its first download (ADR-0023)", async () => {
  const pages = [pageOf(ids("4000000000000001", 4), "p2"), pageOf(ids("4000000000000002", 4), "p3"), pageOf(ids("4000000000000003", 4))];
  let rowsAtFirstDownload: number | null = null;
  const w = world((url) => {
    if (url.includes("/bookmarks")) {
      const t = new URL(url).searchParams.get("pagination_token");
      return { status: 200, body: pages[t === "p2" ? 1 : t === "p3" ? 2 : 0] };
    }
    if (url.includes("video.twimg.com")) rowsAtFirstDownload ??= Number((w.d1.db.prepare("SELECT COUNT(*) AS n FROM bookmarks").get() as { n: number }).n);
    return routes(pages[0])(url);
  });
  await authed(w.store);
  const r = await sync(w.d, { backfill: true });
  assert.equal(rowsAtFirstDownload, 12, "a request canceled during the first download has already recorded all 12 bookmarks");
  assert.equal(r.recorded, 12);
  assert.equal(r.downloaded, MAX_DOWNLOADS_PER_RUN);
  assert.equal(r.queued, 12 - MAX_DOWNLOADS_PER_RUN);
});

test("backfill does not head R2 or fetch posters for page items that are already downloaded", async () => {
  const done = ids("5000000000000000", 6), fresh = "5000000000000009";
  const w = world(routes(pageOf([...done, fresh])));
  for (const id of done) {
    await w.store.upsertBookmark({ post_id: id, posted_at: null, text: null, post_url: `https://x.com/i/status/${id}`, has_video: 1, status: "downloaded", error: null, r2_key: `${id}.mp4`, bytes: 1, duration_ms: null, preview_url: null, now: "2026-08-01T00:00:00Z" });
    await w.r2.put(`${id}.mp4`, new Uint8Array([1]));
  }
  await authed(w.store);
  const heads: string[] = [], head = w.r2.head.bind(w.r2);
  w.r2.head = async (key: string) => { heads.push(key); return head(key); };
  const r = await sync(w.d, { backfill: true });
  assert.deepEqual(heads.filter((k) => !k.includes(fresh)), [], "no R2 head for downloaded rows");
  assert.deepEqual(w.f.calls.map(([u]) => u).filter((u) => u.includes("pbs.twimg.com")), [`https://pbs.twimg.com/${fresh}.jpg`]);
  assert.deepEqual([r.recorded, r.downloaded, r.queued], [1, 1, 0]);
});

test("backfill leaves a failed row failed and reports recorded/queued", async () => {
  const b = fx(); delete b.meta.next_token;
  const w = world(routes(b));
  await w.store.upsertBookmark({ post_id: "1000000000000000001", posted_at: null, text: null, post_url: "https://x.com/i/status/1000000000000000001", has_video: 1, status: "failed", error: "too_large", r2_key: null, bytes: 99, duration_ms: null, preview_url: null, now: "2026-08-01T00:00:00Z" });
  await authed(w.store);
  const r = await sync(w.d, { backfill: true, maxDownloads: 1 });
  const failed = (await w.store.getBookmark("1000000000000000001"))!;
  assert.deepEqual([failed.status, failed.error, failed.bytes], ["failed", "too_large", 99]);
  assert.equal(w.f.calls.filter(([u]) => u.includes("1000000000000000001")).length, 0, "the failed post is not re-downloaded");
  // fixture videos: 2 (one video), 4 (two videos), 5 (no variants → failed). Budget 1 stores 2; 4 stays pending.
  assert.deepEqual([r.recorded, r.downloaded, r.queued], [3, 1, 1]);
  assert.equal((await w.store.getBookmark("1000000000000000004"))!.status, "pending");
});

test("a backfill whose second bookmarks page fails keeps the first page recorded", async () => {
  let page = 0;
  const w = world((url) => {
    if (url.includes("/bookmarks")) return ++page === 1 ? { status: 200, body: fx() } : { status: 429, body: {}, headers: { "x-rate-limit-reset": String(NOW / 1000 + 900) } };
    return routes(fx())(url);
  });
  await authed(w.store);
  await sync(w.d, { backfill: true });
  assert.equal((await w.store.getBookmark("1000000000000000004"))?.status, "pending");
  assert.equal((await w.store.getBookmark("1000000000000000003"))?.status, "no_video");
});

test("a deleted post is never re-downloaded even though its key is gone from R2 (ADR-0011)", async () => {
  const w = world(routes(fx())); await authed(w.store);
  await sync(w.d);
  const id = "1000000000000000001";
  await w.store.deleteVideos(id);
  await w.store.markDeleted(id, "2026-08-30T00:00:00Z");
  const before_updated = (await w.store.getBookmark(id))!.updated_at;
  const before = w.f.calls.filter(([u]) => u.includes("video.twimg")).length;
  const posterBefore = w.f.calls.filter(([u]) => u.includes("pbs.twimg.com")).length;
  const r = await sync(w.d);
  assert.equal(r.downloaded, 0);
  assert.equal(w.f.calls.filter(([u]) => u.includes("video.twimg")).length, before, "no download attempted");
  assert.equal(w.f.calls.filter(([u]) => u.includes("pbs.twimg.com")).length, posterBefore, "no poster capture attempted");
  assert.equal(w.r2.objects.has(`${id}.mp4`), false);
  const b = (await w.store.getBookmark(id))!;
  assert.equal(b.deleted_at, "2026-08-30T00:00:00Z");
  assert.equal(b.status, "downloaded", "row untouched by the rerun");
  assert.equal(b.updated_at, before_updated, "row untouched by the rerun");
});

test("storage alert re-fires per STORAGE_ALERT_STEP_BYTES step and re-arms after a decrease", async () => {
  const GiB = 1024 ** 3, STEP = STORAGE_ALERT_STEP_BYTES; // 3 GiB → steps at 9, 12, 15 GiB
  const tg: string[] = [];
  const w = world((url, init) => {
    if (url.includes("api.telegram.org")) { tg.push(JSON.parse(String(init.body)).text); return { status: 200, body: { ok: true } }; }
    return routes(fx())(url);
  });
  await authed(w.store);
  // Legacy one-shot key from before the step scheme; 6 bytes short of the 12 GiB step, this run adds 12.
  await w.store.patchStatus({ totalBytes: 4 * STEP - 6, alerts: { storage: "2026-08-30T12:00:37Z" } });
  await sync(w.d);
  let a = (await w.store.getStatus()).alerts ?? {};
  assert.ok(a["storage:12GB"], "fires for the 12 GiB step");
  assert.equal(a.storage, undefined, "legacy key retired");
  assert.match(tg.at(-1)!, /12\.00 GB/);
  await sync(w.d);
  assert.equal(tg.length, 1, "same step, no re-fire");
  await w.store.patchStatus({ totalBytes: 5 * STEP });
  await sync(w.d);
  a = (await w.store.getStatus()).alerts ?? {};
  assert.ok(a["storage:15GB"], "next step fires again");
  assert.equal(a["storage:12GB"], undefined, "only the current step stays marked");
  assert.equal(tg.length, 2);
  await w.store.patchStatus({ totalBytes: 10 * GiB }); // a delete shrank the store
  await sync(w.d);
  assert.equal((await w.store.getStatus()).alerts?.["storage:15GB"], undefined, "re-armed below the step");
  await w.store.patchStatus({ totalBytes: 5 * STEP });
  await sync(w.d);
  assert.equal(tg.length, 4, "9 GiB step on the way down, 15 GiB step again on regrowth");
});
