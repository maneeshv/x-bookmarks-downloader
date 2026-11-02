import { verifyAccessJwt } from "#src/access";
import { renderIndex, renderQueue, renderStats, renderWatch } from "#src/html";
import { BACKFILL_MAX_DOWNLOADS, BACKFILL_MAX_POSTERS, DESCRIPTION_MAX, MAX_DOWNLOADS_PER_RUN, MAX_FILE_BYTES, MIN_FILE_BYTES, POST_ID_RE, TAG_MAX, TAGS_MAX, TITLE_MAX, VIDEO_KEY_RE } from "#src/limits";
import { DEFAULT_LIBRARY_PAGE_SIZE, LIBRARY_PAGE_SIZES, Store, type LibraryQuery, type MetaPatch } from "#src/store";
import { backfillPosters, sync, type Deps } from "#src/sync";
import { authorizeUrl, exchangeCode, fetchMe, pkceChallenge, randomToken, type Fetch } from "#src/x";

export type AppEnv = {
  X_CLIENT_ID: string; X_CLIENT_SECRET: string; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string;
  TEAM_DOMAIN: string; POLICY_AUD: string; PUBLIC_ORIGIN: string; OWNER_EMAIL: string;
  VIDEOS: R2Bucket; KV: KVNamespace; DB: D1Database;
};

function deps(env: AppEnv, f: Fetch): Deps {
  return {
    // Arrow wrapper: calling `deps.fetch(...)` with the global fetch as a method throws "Illegal invocation" in Workers.
    store: new Store(env.KV, env.DB, env.VIDEOS), fetch: (input, init) => f(input, init),
    cfg: {
      clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET, redirectUri: `${env.PUBLIC_ORIGIN}/oauth/callback`, publicOrigin: env.PUBLIC_ORIGIN,
      telegram: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID } : undefined,
    },
  };
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const html = (s: string) => new Response(s, { headers: { "content-type": "text/html; charset=utf-8" } });
const POSTER_PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#171b21"/><path d="m6.5 3 4 1.5v.5l-4 1.5z" fill="#59616d"/></svg>`;

// R2 (and miniflare) populate obj.range unconditionally on a GET — even a plain request
// gets {offset: 0, length: size} back — so whether to answer 206 must come from the request,
// not from obj.range's presence. This also covers every R2Range shape (offset+length,
// offset-only, suffix-only) rather than assuming the fake's/R2's default shape.
function servedRange(obj: R2ObjectBody): { offset: number; length: number } {
  // Real R2 returns the range object with all three keys present (unused ones undefined), so
  // test for values, never `"suffix" in r` — that produced `Content-Range: bytes NaN-NaN/size`.
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (!r) return { offset: 0, length: obj.size };
  if (r.suffix != null) return { offset: obj.size - r.suffix, length: r.suffix };
  const offset = r.offset ?? 0;
  return { offset, length: r.length ?? obj.size - offset };
}

async function video(store: Store, key: string, req: Request): Promise<Response> {
  if (!VIDEO_KEY_RE.test(key)) return new Response("not found", { status: 404 });
  let obj: R2ObjectBody | R2Object | null;
  try { obj = await store.getVideo(key, req.headers); }
  catch (e) {
    // R2 throws on an unsatisfiable Range (start ≥ size); only a Range request can hit that, so
    // any other throw (a real R2/network fault) must propagate instead of being reported as 416.
    if (!req.headers.has("range")) throw e;
    console.error("video range", key, e);
    return new Response(null, { status: 416 });
  }
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  // R2's onlyIf drops the body when the conditional matches — that's a cache-revalidation
  // success (304 for If-None-Match or If-Modified-Since), not a precondition failure (412) —
  // reserve 412 for other onlyIf mismatches (e.g. If-Match / If-Unmodified-Since).
  if (!("body" in obj)) return new Response(null, { status: req.headers.has("if-none-match") || req.headers.has("if-modified-since") ? 304 : 412, headers });
  if (req.headers.has("range")) {
    const { offset, length } = servedRange(obj);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

async function poster(store: Store, postId: string, req: Request): Promise<Response> {
  if (!POST_ID_RE.test(postId)) return new Response("not found", { status: 404 });
  const obj = await store.getPoster(postId, req.headers);
  const headers = new Headers({ "x-content-type-options": "nosniff" });
  if (!obj) {
    headers.set("content-type", "image/svg+xml");
    headers.set("cache-control", "no-store");
    return new Response(POSTER_PLACEHOLDER, { headers });
  }
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("content-length", String(obj.size));
  headers.set("cache-control", "private, max-age=31536000, immutable");
  if (!("body" in obj)) return new Response(null, { status: req.headers.has("if-none-match") || req.headers.has("if-modified-since") ? 304 : 412, headers });
  return new Response(obj.body, { headers });
}

// Body → MetaPatch, or null when it is not an object, has a wrongly-typed field, or names no field.
function parseMetaPatch(b: unknown): MetaPatch | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>, p: MetaPatch = {};
  if ("title" in o) { if (typeof o.title !== "string") return null; p.title = o.title; }
  if ("description" in o) { if (typeof o.description !== "string") return null; p.description = o.description; }
  if ("favorite" in o) { if (typeof o.favorite !== "boolean") return null; p.favorite = o.favorite; }
  if ("tags" in o) {
    if (!Array.isArray(o.tags) || o.tags.length > TAGS_MAX || o.tags.some((tag) => typeof tag !== "string")) return null;
    const normalized = o.tags.map((tag) => tag.trim());
    if (normalized.some((tag) => !tag || tag.length > TAG_MAX)) return null;
    p.tags = normalized.filter((tag, i, all) => all.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === i);
  }
  if ("resume_ms" in o) {
    if (typeof o.resume_ms !== "number" || !Number.isSafeInteger(o.resume_ms) || o.resume_ms < 0) return null;
    p.resume_ms = o.resume_ms;
  }
  return Object.keys(p).length ? p : null;
}

function parseLibraryQuery(url: URL): LibraryQuery {
  const sort = url.searchParams.get("sort"), rawPage = Number(url.searchParams.get("page"));
  const rawPerPage = Number(url.searchParams.get("perPage"));
  const tags = url.searchParams.getAll("tag").map((tag) => tag.trim())
    .filter((tag, i, all) => tag.length > 0 && tag.length <= TAG_MAX && all.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === i)
    .slice(0, TAGS_MAX);
  return {
    q: url.searchParams.get("q")?.trim() || undefined,
    fav: url.searchParams.get("fav") === "1",
    tags: tags.length ? tags : undefined,
    sort: sort === "oldest" || sort === "title" || sort === "largest" || sort === "smallest" || sort === "longest" || sort === "shortest" ? sort : "newest",
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    perPage: LIBRARY_PAGE_SIZES.includes(rawPerPage as typeof LIBRARY_PAGE_SIZES[number])
      ? rawPerPage as typeof LIBRARY_PAGE_SIZES[number] : DEFAULT_LIBRARY_PAGE_SIZE,
  };
}

export async function handle(req: Request, env: AppEnv, f: Fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  // Every route, including the OAuth callback, sits behind Access (spec §4); the JWT check defends a misconfigured policy.
  const jwt = req.headers.get("cf-access-jwt-assertion");
  let email = "";
  try {
    if (!jwt) throw new Error("missing");
    const identity = await verifyAccessJwt(f, jwt, env.TEAM_DOMAIN, env.POLICY_AUD);
    if (typeof identity.email !== "string" || !identity.email.trim()) throw new Error("missing email");
    email = identity.email.trim();
  }
  catch { return new Response("forbidden", { status: 403 }); }
  const isOwner = !!env.OWNER_EMAIL?.trim() && email.toLowerCase() === env.OWNER_EMAIL.trim().toLowerCase();
  const viewerPath = url.pathname === "/" || /^\/watch\/[^/]+$/.test(url.pathname) || /^\/(?:v|p)\/[^/]+$/.test(url.pathname);
  if (!isOwner && (req.method !== "GET" || !viewerPath)) return new Response("forbidden", { status: 403 });

  const d = deps(env, f);
  const { store } = d;
  if (url.pathname === "/api/videos/retry-all") {
    // Matched before the :id pattern (it would read "retry-all" as a post id → 404). Same JSON-only rule as the other POSTs.
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (!req.headers.get("content-type")?.startsWith("application/json")) return new Response("json only", { status: 415 });
    return json({ retried: await store.retryAll(new Date().toISOString()) });
  }
  if (url.pathname === "/api/settings/max-file-bytes") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (!req.headers.get("content-type")?.startsWith("application/json")) return new Response("json only", { status: 415 });
    const body = await req.json().catch(() => null) as { maxFileBytes?: unknown } | null;
    const value = body?.maxFileBytes;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < MIN_FILE_BYTES || value > MAX_FILE_BYTES) return new Response("bad request", { status: 400 });
    await store.putMaxFileBytes(value);
    return new Response(null, { status: 204 });
  }
  const api = /^\/api\/videos\/([^/]+)(\/retry)?$/.exec(url.pathname);
  if (api) {
    const id = api[1]!;
    if (!POST_ID_RE.test(id)) return new Response("not found", { status: 404 });
    if (api[2]) {
      // failed → pending; the next sync that sees the post re-attempts it (cron scans only the newest page, /backfill scans all).
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      if (!req.headers.get("content-type")?.startsWith("application/json")) return new Response("json only", { status: 415 });
      return new Response(null, { status: (await store.retry(id, new Date().toISOString())) ? 204 : 404 });
    }
    if (req.method === "DELETE") {
      // ponytail: a cron tick between deleteVideos and markDeleted can re-download the object under the tombstone; a repeat DELETE (row is still 'downloaded') cleans it up.
      // R2 first, tombstone second (spec §5): a tombstone must never exist for a video still in R2.
      // A repeat delete is a 204: the row is still `downloaded`, and R2 delete ignores missing keys.
      const b = await store.getBookmark(id);
      if (b?.status !== "downloaded") return new Response("not found", { status: 404 });
      await store.deleteVideos(id);
      await store.markDeleted(id, new Date().toISOString());
      // Keep the KV storage counter (and the 9 GB alert in sync.ts) honest; only the first delete of a row counts.
      if (!b.deleted_at) await store.patchStatus({ totalBytes: Math.max(0, ((await store.getStatus()).totalBytes ?? 0) - (b.bytes ?? 0)) });
      return new Response(null, { status: 204 });
    }
    if (req.method === "POST") {
      // JSON-only bodies: a cross-site <form> cannot set this content-type, so no CSRF token is needed.
      if (!req.headers.get("content-type")?.startsWith("application/json")) return new Response("json only", { status: 415 });
      const patch = parseMetaPatch(await req.json().catch(() => null));
      if (!patch) return new Response("bad request", { status: 400 });
      if ((patch.title?.length ?? 0) > TITLE_MAX || (patch.description?.length ?? 0) > DESCRIPTION_MAX) return new Response("too long", { status: 413 });
      if (patch.tags) patch.tags = await store.canonicalizeTags(patch.tags);
      if (!(await store.updateMeta(id, patch, new Date().toISOString()))) return new Response("not found", { status: 404 });
      return new Response(null, { status: 204 });
    }
    return new Response("method not allowed", { status: 405 });
  }
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });

  if (url.pathname === "/") {
    const q = parseLibraryQuery(url), total = await store.countLibrary(q);
    const perPage = q.perPage ?? DEFAULT_LIBRARY_PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    q.page = Math.min(q.page ?? 1, totalPages);
    return html(renderIndex(await store.listLibrary(q, perPage, (q.page - 1) * perPage), await store.getStatus(), q, total, isOwner, await store.listTags(), isOwner ? await store.countQueue().then((c) => c.pending + c.failed) : 0));
  }
  const watch = /^\/watch\/([^/]+)$/.exec(url.pathname);
  if (watch) {
    if (!POST_ID_RE.test(watch[1]!)) return new Response("not found", { status: 404 });
    const b = await store.getBookmark(watch[1]!);
    if (!b || b.status !== "downloaded" || b.deleted_at || !b.r2_key) return new Response("not found", { status: 404 });
    return html(renderWatch(b, parseLibraryQuery(url), isOwner, isOwner ? await store.listTags() : []));
  }
  if (url.pathname.startsWith("/v/")) {
    let key: string;
    try { key = decodeURIComponent(url.pathname.slice(3)); }
    catch { return new Response("not found", { status: 404 }); }
    return video(store, key, req);
  }
  const posterRoute = /^\/p\/([^/]+)$/.exec(url.pathname);
  if (posterRoute) return poster(store, posterRoute[1]!, req);
  if (url.pathname === "/stats") {
    return html(renderStats(await store.stats(), await store.getStatus(), await store.getPausedUntil(), await store.getMaxFileBytes()));
  }
  if (url.pathname === "/queue") return html(renderQueue(await store.listQueue(), await store.getStatus(), await store.getPausedUntil()));
  if (url.pathname === "/status") return json({ ...(await store.getStatus()), pausedUntil: await store.getPausedUntil(), userId: await store.getUserId() });
  if (url.pathname === "/oauth/start") {
    const state = randomToken(16), verifier = randomToken(64);
    await store.putPkce(state, verifier);
    return Response.redirect(authorizeUrl(d.cfg, state, await pkceChallenge(verifier)), 302);
  }
  if (url.pathname === "/oauth/callback") {
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    const verifier = state && (await store.takePkce(state));
    if (!code || !verifier) return new Response("bad state", { status: 400 });
    const tokens = await exchangeCode(f, d.cfg, code, verifier);
    await store.putTokens(tokens);
    await store.putUserId(await fetchMe(f, tokens.access));
    await store.clearPause();
    await store.patchStatus({ auth: "ok", lastError: null });
    return Response.redirect(`${env.PUBLIC_ORIGIN}/`, 302);
  }
  if (url.pathname === "/backfill") {
    if (url.searchParams.get("durations") === "1") return json(await sync(d, { durations: true }));
    const rawPosters = url.searchParams.get("posters"), after = url.searchParams.get("after");
    if (rawPosters !== null) {
      if (url.searchParams.has("downloads") || (after !== null && !POST_ID_RE.test(after))) return new Response("bad request", { status: 400 });
      const n = Number(rawPosters);
      if (!Number.isInteger(n)) return new Response("bad request", { status: 400 });
      return json(await backfillPosters(d, Math.min(Math.max(1, n), BACKFILL_MAX_POSTERS), after));
    }
    if (after !== null) return new Response("bad request", { status: 400 });
    // ?downloads=N lets the owner drain a backlog faster than the cron's per-run cap; clamped to a hard ceiling.
    const n = Number(url.searchParams.get("downloads")) || MAX_DOWNLOADS_PER_RUN;
    return json(await sync(d, { backfill: true, maxDownloads: Math.min(Math.max(1, n), BACKFILL_MAX_DOWNLOADS) }));
  }
  return new Response("not found", { status: 404 });
}

export default {
  fetch: (req: Request, env: AppEnv) => handle(req, env),
  async scheduled(_c: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    ctx.waitUntil(sync(deps(env, fetch)));
  },
} satisfies ExportedHandler<AppEnv>;
