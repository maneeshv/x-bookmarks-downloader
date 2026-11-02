import { DEFAULT_MAX_FILE_BYTES, MAX_FILE_BYTES, MIN_FILE_BYTES } from "#src/limits";
import type { Tokens } from "#src/x";

export type BookmarkStatus = "no_video" | "pending" | "downloaded" | "failed";
export type BookmarkRow = {
  post_id: string; first_seen_at: string; posted_at: string | null; text: string | null; post_url: string;
  has_video: 0 | 1; status: BookmarkStatus; error: string | null; r2_key: string | null; bytes: number | null; duration_ms: number | null;
  preview_url: string | null; updated_at: string;
  // Library metadata (migrations 0002/0003_tags, ADR-0011/0020). Owner-set; sync never writes them.
  title: string | null; description: string | null; favorite: 0 | 1; tags: string | null; deleted_at: string | null; resume_ms?: number | null;
};
export type BookmarkUpsert = Omit<BookmarkRow, "first_seen_at" | "updated_at" | "title" | "description" | "favorite" | "tags" | "deleted_at" | "resume_ms"> & { now: string };
export type Status = {
  lastRun?: string; lastError?: string | null; auth?: "ok" | "needs_reauth"; counts?: Record<string, number>;
  totalBytes?: number; noMediaRuns?: number; alerts?: Record<string, string>;
};
// One row per (status, error, deleted) group; `bytes` sums the group's stored bytes.
export type StatRow = { status: BookmarkStatus; error: string | null; deleted: 0 | 1; n: number; bytes: number };
export type TagOption = { tag: string; count: number };
export type VideoMeta = { postId: string; text: string; postUrl: string; postedAt: string | null; previewUrl: string | null; bitRate: number };
export type MissingDuration = { post_id: string; r2_key: string };
export const posterKey = (postId: string) => `posters/${postId}`;
export const LIBRARY_PAGE_SIZES = [10, 20, 30, 50] as const;
export type LibraryPageSize = typeof LIBRARY_PAGE_SIZES[number];
export const DEFAULT_LIBRARY_PAGE_SIZE: LibraryPageSize = 10;
export type LibraryQuery = {
  q?: string; fav?: boolean; tags?: string[]; sort?: "newest" | "oldest" | "title" | "largest" | "smallest" | "longest" | "shortest";
  page?: number; perPage?: LibraryPageSize;
};
// A key present means "set it"; "" stores NULL. Callers validate types/lengths (src/index.ts).
export type MetaPatch = { title?: string; description?: string; favorite?: boolean; tags?: string[]; resume_ms?: number };
const LIBRARY_ORDER: Record<NonNullable<LibraryQuery["sort"]>, string> = {
  newest: "posted_at DESC, post_id DESC",
  oldest: "posted_at ASC, post_id ASC",
  title: "COALESCE(title, text) COLLATE NOCASE ASC, post_id DESC",
  largest: "bytes IS NULL ASC, bytes DESC, post_id DESC",
  smallest: "bytes IS NULL ASC, bytes ASC, post_id DESC",
  longest: "duration_ms IS NULL ASC, duration_ms DESC, post_id DESC",
  shortest: "duration_ms IS NULL ASC, duration_ms ASC, post_id DESC",
};
const libraryFilter = ({ q, fav, tags }: LibraryQuery): { where: string; args: unknown[] } => {
  const clauses = ["status = 'downloaded'", "deleted_at IS NULL"], args: unknown[] = [];
  if (fav) clauses.push("favorite = 1");
  for (const tag of tags ?? []) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(COALESCE(bookmarks.tags, '[]')) WHERE value = ? COLLATE NOCASE)");
    args.push(tag);
  }
  if (q) {
    clauses.push("(title LIKE ? OR description LIKE ? OR text LIKE ? OR EXISTS (SELECT 1 FROM json_each(COALESCE(tags, '[]')) WHERE value LIKE ?))");
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  return { where: clauses.join(" AND "), args };
};

// R2 head(key) is the download truth (ADR-0003); D1 is the index (ADR-0007); KV is small mutable state.
const UPSERT = `INSERT INTO bookmarks (post_id, first_seen_at, posted_at, text, post_url, has_video, status, error, r2_key, bytes, duration_ms, preview_url, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(post_id) DO UPDATE SET
  status      = CASE WHEN bookmarks.status = 'downloaded' THEN 'downloaded' ELSE excluded.status END,
  error       = CASE WHEN bookmarks.status = 'downloaded' THEN bookmarks.error ELSE excluded.error END,
  r2_key      = COALESCE(excluded.r2_key, bookmarks.r2_key),
  bytes       = COALESCE(excluded.bytes, bookmarks.bytes),
  duration_ms = COALESCE(excluded.duration_ms, bookmarks.duration_ms),
  preview_url = COALESCE(excluded.preview_url, bookmarks.preview_url),
  posted_at   = COALESCE(excluded.posted_at, bookmarks.posted_at),
  text        = COALESCE(excluded.text, bookmarks.text),
  has_video   = MAX(bookmarks.has_video, excluded.has_video),
  updated_at  = excluded.updated_at`;

export class Store {
  readonly kv: KVNamespace;
  readonly db: D1Database;
  readonly r2: R2Bucket;
  constructor(kv: KVNamespace, db: D1Database, r2: R2Bucket) {
    this.kv = kv;
    this.db = db;
    this.r2 = r2;
  }

  getTokens(): Promise<Tokens | null> { return this.kv.get<Tokens>("oauth", "json"); }
  putTokens(t: Tokens): Promise<void> { return this.kv.put("oauth", JSON.stringify(t)); }
  clearTokens(): Promise<void> { return this.kv.delete("oauth"); }
  getUserId(): Promise<string | null> { return this.kv.get("userId"); }
  putUserId(id: string): Promise<void> { return this.kv.put("userId", id); }

  async getStatus(): Promise<Status> { return (await this.kv.get<Status>("status", "json")) ?? {}; }
  async patchStatus(p: Partial<Status>): Promise<Status> {
    const s = { ...(await this.getStatus()), ...p };
    await this.kv.put("status", JSON.stringify(s));
    return s;
  }
  async getPausedUntil(): Promise<number> { return Number(await this.kv.get("paused_until")) || 0; }
  pause(untilMs: number): Promise<void> { return this.kv.put("paused_until", String(untilMs)); }
  clearPause(): Promise<void> { return this.kv.delete("paused_until"); }

  async getMaxFileBytes(): Promise<number> {
    const n = Number(await this.kv.get("max_file_bytes"));
    return Number.isSafeInteger(n) && n >= MIN_FILE_BYTES && n <= MAX_FILE_BYTES ? n : DEFAULT_MAX_FILE_BYTES;
  }
  putMaxFileBytes(bytes: number): Promise<void> { return this.kv.put("max_file_bytes", String(bytes)); }

  putPkce(state: string, verifier: string): Promise<void> { return this.kv.put(`pkce:${state}`, verifier, { expirationTtl: 600 }); }
  async takePkce(state: string): Promise<string | null> {
    const v = await this.kv.get(`pkce:${state}`);
    if (v) await this.kv.delete(`pkce:${state}`);
    return v;
  }

  async upsertBookmark(r: BookmarkUpsert): Promise<void> {
    await this.db.prepare(UPSERT)
      .bind(r.post_id, r.now, r.posted_at, r.text, r.post_url, r.has_video, r.status, r.error, r.r2_key, r.bytes, r.duration_ms, r.preview_url, r.now)
      .run();
  }
  // Insert-only (ADR-0023): a backfill records each bookmark it reads before downloading anything, without
  // resetting a failed row, reordering the pending queue, or reviving a tombstone. Returns whether a row was added.
  async recordSeen(r: BookmarkUpsert): Promise<boolean> {
    const res = await this.db.prepare(`${UPSERT.slice(0, UPSERT.indexOf("ON CONFLICT"))}ON CONFLICT(post_id) DO NOTHING`)
      .bind(r.post_id, r.now, r.posted_at, r.text, r.post_url, r.has_video, r.status, r.error, r.r2_key, r.bytes, r.duration_ms, r.preview_url, r.now)
      .run();
    return res.meta.changes > 0;
  }
  getBookmark(postId: string): Promise<BookmarkRow | null> {
    return this.db.prepare("SELECT * FROM bookmarks WHERE post_id = ?").bind(postId).first<BookmarkRow>();
  }
  // ponytail: LIKE over ≤800 rows (X's bookmark ceiling, ADR-0007); FTS5 if it ever gets slow.
  async countLibrary(query: LibraryQuery = {}): Promise<number> {
    const { where, args } = libraryFilter(query);
    const row = await this.db.prepare(`SELECT COUNT(*) AS n FROM bookmarks WHERE ${where}`).bind(...args).first<{ n: number }>();
    return row?.n ?? 0;
  }
  async listLibrary(query: LibraryQuery = {}, limit = 500, offset = 0): Promise<BookmarkRow[]> {
    const { sort = "newest" } = query, { where, args } = libraryFilter(query);
    const { results } = await this.db
      .prepare(`SELECT * FROM bookmarks WHERE ${where} ORDER BY ${LIBRARY_ORDER[sort]} LIMIT ? OFFSET ?`)
      .bind(...args, limit, offset).all<BookmarkRow>();
    return results;
  }
  async listTags(): Promise<TagOption[]> {
    const { results } = await this.db
      .prepare("SELECT value AS tag, first_seen_at, post_id FROM bookmarks, json_each(COALESCE(tags, '[]')) WHERE status = 'downloaded' AND deleted_at IS NULL ORDER BY value COLLATE NOCASE, first_seen_at, post_id")
      .all<{ tag: string; first_seen_at: string; post_id: string }>();
    const found = new Map<string, { option: TagOption; postIds: Set<string> }>();
    for (const row of results) {
      const key = row.tag.toLowerCase(), existing = found.get(key);
      if (existing) {
        existing.postIds.add(row.post_id);
        existing.option.count = existing.postIds.size;
      } else found.set(key, { option: { tag: row.tag, count: 1 }, postIds: new Set([row.post_id]) });
    }
    return [...found.values()].map(({ option }) => option);
  }
  async canonicalizeTags(tags: string[]): Promise<string[]> {
    const available = new Map((await this.listTags()).map((option) => [option.tag.toLowerCase(), option.tag]));
    return tags.map((tag) => available.get(tag.toLowerCase()) ?? tag);
  }
  stats(): Promise<StatRow[]> {
    return this.db
      .prepare("SELECT status, error, deleted_at IS NOT NULL AS deleted, COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM bookmarks GROUP BY 1, 2, 3")
      .all<StatRow>().then((r) => r.results);
  }
  async listByStatus(statuses: BookmarkStatus[], limit = 500): Promise<BookmarkRow[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM bookmarks WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY updated_at DESC, post_id DESC LIMIT ?`)
      .bind(...statuses, limit).all<BookmarkRow>();
    return results;
  }
  async listPendingIds(limit = 100): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT post_id FROM bookmarks WHERE status = 'pending' AND deleted_at IS NULL ORDER BY updated_at ASC, post_id ASC LIMIT ?")
      .bind(limit).all<{ post_id: string }>();
    return results.map((r) => r.post_id);
  }
  // The /queue page: pending in the cron's drain order (same ORDER BY as listPendingIds), failed newest first.
  async listQueue(limit = 500): Promise<{ pending: BookmarkRow[]; failed: BookmarkRow[] }> {
    const q = (status: BookmarkStatus, order: string) => this.db
      .prepare(`SELECT * FROM bookmarks WHERE status = ? AND deleted_at IS NULL ORDER BY ${order} LIMIT ?`)
      .bind(status, limit).all<BookmarkRow>().then((r) => r.results);
    return { pending: await q("pending", "updated_at ASC, post_id ASC"), failed: await q("failed", "updated_at DESC, post_id DESC") };
  }
  async countQueue(): Promise<{ pending: number; failed: number }> {
    const row = await this.db
      .prepare("SELECT COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'failed'), 0) AS failed FROM bookmarks WHERE status IN ('pending', 'failed') AND deleted_at IS NULL")
      .first<{ pending: number; failed: number }>();
    return { pending: row?.pending ?? 0, failed: row?.failed ?? 0 };
  }
  async listMissingDurations(limit: number): Promise<MissingDuration[]> {
    const { results } = await this.db
      .prepare("SELECT post_id, r2_key FROM bookmarks WHERE status = 'downloaded' AND duration_ms IS NULL AND r2_key IS NOT NULL AND deleted_at IS NULL ORDER BY post_id LIMIT ?")
      .bind(limit).all<MissingDuration>();
    return results;
  }
  async updateDuration(postId: string, r2Key: string, durationMs: number): Promise<boolean> {
    const r = await this.db
      .prepare("UPDATE bookmarks SET duration_ms = ? WHERE post_id = ? AND r2_key = ? AND status = 'downloaded' AND duration_ms IS NULL AND deleted_at IS NULL")
      .bind(durationMs, postId, r2Key).run();
    return r.meta.changes > 0;
  }
  async listPosterSources(after: string | null, limit: number): Promise<BookmarkRow[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM bookmarks WHERE status = 'downloaded' AND deleted_at IS NULL AND preview_url IS NOT NULL AND post_id > ? ORDER BY post_id ASC LIMIT ?")
      .bind(after ?? "", limit).all<BookmarkRow>();
    return results;
  }
  // failed → pending: sync() re-attempts pending rows the next time it sees the post (src/sync.ts processItem).
  async retry(postId: string, now: string): Promise<boolean> {
    const r = await this.db.prepare("UPDATE bookmarks SET status = 'pending', error = NULL, updated_at = ? WHERE post_id = ? AND status = 'failed'").bind(now, postId).run();
    return r.meta.changes > 0;
  }
  // Every failed row at once (the /stats "Retry all failed" button); returns how many were reset.
  async retryAll(now: string): Promise<number> {
    const r = await this.db.prepare("UPDATE bookmarks SET status = 'pending', error = NULL, updated_at = ? WHERE status = 'failed'").bind(now).run();
    return r.meta.changes;
  }
  async updateMeta(postId: string, p: MetaPatch, now: string): Promise<boolean> {
    const sets: string[] = [], args: unknown[] = [];
    if (p.title !== undefined) { sets.push("title = ?"); args.push(p.title || null); }
    if (p.description !== undefined) { sets.push("description = ?"); args.push(p.description || null); }
    if (p.favorite !== undefined) { sets.push("favorite = ?"); args.push(p.favorite ? 1 : 0); }
    if (p.tags !== undefined) { sets.push("tags = ?"); args.push(p.tags.length ? JSON.stringify(p.tags) : null); }
    if (p.resume_ms !== undefined) { sets.push("resume_ms = ?"); args.push(p.resume_ms || null); }
    sets.push("updated_at = ?"); args.push(now);
    const r = await this.db
      .prepare(`UPDATE bookmarks SET ${sets.join(", ")} WHERE post_id = ? AND status = 'downloaded' AND deleted_at IS NULL`)
      .bind(...args, postId).run();
    return r.meta.changes > 0;
  }
  // Tombstone (ADR-0011): sync() skips the row forever, even though its key is gone from R2.
  async markDeleted(postId: string, now: string): Promise<boolean> {
    const r = await this.db
      .prepare("UPDATE bookmarks SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE post_id = ? AND status = 'downloaded'")
      .bind(now, now, postId).run();
    return r.meta.changes > 0;
  }
  // ponytail: X allows ≤4 media per post (key scheme in src/x.ts) and R2 ignores missing keys,
  // so name the sibling keys instead of paying a list() call.
  deleteVideos(postId: string): Promise<void> {
    return this.r2.delete([`${postId}.mp4`, ...[1, 2, 3, 4].map((n) => `${postId}-${n}.mp4`), posterKey(postId)]);
  }

  async has(key: string): Promise<boolean> { return (await this.r2.head(key)) !== null; }
  // body typed ArrayBufferLike (not ArrayBuffer): workerd's ambient TextEncoder.encode()
  // returns bare `Uint8Array` (worker-configuration.d.ts), whose `.buffer` widens to
  // ArrayBufferLike under esnext lib. Real callers never produce a SharedArrayBuffer, so the
  // narrowing cast to R2Bucket.put's own ArrayBuffer type below is safe.
  async putVideo(key: string, body: ReadableStream | ArrayBufferLike, meta: VideoMeta, contentType = "video/mp4"): Promise<void> {
    const customMetadata = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, v === null ? "" : String(v)]));
    await this.r2.put(key, body as ReadableStream | ArrayBuffer, { httpMetadata: { contentType }, customMetadata });
  }
  getVideo(key: string, reqHeaders: Headers): Promise<R2ObjectBody | R2Object | null> {
    return this.r2.get(key, { range: reqHeaders, onlyIf: reqHeaders });
  }
  putPoster(postId: string, body: ReadableStream, contentType: string): Promise<R2Object | null> {
    return this.r2.put(posterKey(postId), body, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType } });
  }
  getPoster(postId: string, reqHeaders: Headers): Promise<R2ObjectBody | R2Object | null> {
    return this.r2.get(posterKey(postId), { onlyIf: reqHeaders });
  }
}
