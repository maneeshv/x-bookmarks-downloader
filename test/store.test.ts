import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_FILE_BYTES, MAX_FILE_BYTES, MIN_FILE_BYTES } from "#src/limits";
import { Store } from "#src/store";
import { FakeD1, FakeKV, FakeR2 } from "./fakes.ts";

const mk = () => { const kv = new FakeKV(), r2 = new FakeR2(), d1 = new FakeD1(); return { kv, r2, d1, s: new Store(kv.asKV(), d1.asD1(), r2.asR2()) }; };
const row = (over: Partial<Parameters<Store["upsertBookmark"]>[0]> = {}) => ({
  post_id: "1", posted_at: "2026-08-01T00:00:00Z", text: "t", post_url: "https://x.com/i/status/1", has_video: 1 as const,
  status: "pending" as const, error: null, r2_key: null, bytes: null, duration_ms: null, preview_url: null, now: "2026-08-29T00:00:00Z", ...over,
});

test("tokens, userId, status, pause round-trip through KV", async () => {
  const { s } = mk();
  assert.equal(await s.getTokens(), null);
  await s.putTokens({ access: "a", refresh: "r", expiresAt: 5 });
  assert.deepEqual(await s.getTokens(), { access: "a", refresh: "r", expiresAt: 5 });
  await s.putUserId("42"); assert.equal(await s.getUserId(), "42");
  assert.deepEqual(await s.getStatus(), {});
  await s.patchStatus({ lastRun: "x" }); await s.patchStatus({ auth: "ok" });
  assert.deepEqual(await s.getStatus(), { lastRun: "x", auth: "ok" });
  assert.equal(await s.getPausedUntil(), 0);
  await s.pause(123); assert.equal(await s.getPausedUntil(), 123);
  await s.clearPause(); assert.equal(await s.getPausedUntil(), 0);
});

test("max file bytes defaults safely, persists, and rejects corrupt KV state", async () => {
  const { s, kv } = mk();
  assert.equal(await s.getMaxFileBytes(), DEFAULT_MAX_FILE_BYTES);
  await s.putMaxFileBytes(1536 * 1024 ** 2);
  assert.equal(await s.getMaxFileBytes(), 1536 * 1024 ** 2);
  for (const invalid of ["wat", "1.5", String(MIN_FILE_BYTES - 1), String(MAX_FILE_BYTES + 1)]) {
    await kv.put("max_file_bytes", invalid);
    assert.equal(await s.getMaxFileBytes(), DEFAULT_MAX_FILE_BYTES, invalid);
  }
});

test("pkce verifier is single-use", async () => {
  const { s } = mk();
  await s.putPkce("st", "ver");
  assert.equal(await s.takePkce("st"), "ver");
  assert.equal(await s.takePkce("st"), null);
});

test("upsert is idempotent, keeps first_seen_at, never downgrades downloaded", async () => {
  const { s } = mk();
  await s.upsertBookmark(row());
  await s.upsertBookmark(row({ now: "2026-08-30T00:00:00Z", status: "downloaded", r2_key: "1.mp4", bytes: 10 }));
  await s.upsertBookmark(row({ now: "2026-08-31T00:00:00Z", status: "pending" }));
  const b = await s.getBookmark("1");
  assert.equal(b?.first_seen_at, "2026-08-29T00:00:00Z");
  assert.equal(b?.updated_at, "2026-08-31T00:00:00Z");
  assert.equal(b?.status, "downloaded");
  assert.equal(b?.r2_key, "1.mp4");
  assert.equal(b?.bytes, 10);
  assert.equal((await s.listLibrary()).length, 1);
});

test("listLibrary is newest-first and only downloaded", async () => {
  const { s } = mk();
  await s.upsertBookmark(row({ post_id: "1", now: "2026-08-01T00:00:00Z", status: "downloaded", r2_key: "1.mp4" }));
  await s.upsertBookmark(row({ post_id: "2", now: "2026-08-02T00:00:00Z", status: "downloaded", r2_key: "2.mp4" }));
  await s.upsertBookmark(row({ post_id: "3", now: "2026-08-03T00:00:00Z", status: "no_video", has_video: 0 }));
  assert.deepEqual((await s.listLibrary()).map((r) => r.post_id), ["2", "1"]);
});

test("putVideo stores metadata as strings; has() reflects R2", async () => {
  const { s, r2 } = mk();
  assert.equal(await s.has("1.mp4"), false);
  await s.putVideo("1.mp4", new TextEncoder().encode("abc").buffer, { postId: "1", text: "t", postUrl: "u", postedAt: null, previewUrl: null, bitRate: 5 });
  assert.equal(await s.has("1.mp4"), true);
  assert.equal(r2.objects.get("1.mp4")!.customMetadata.bitRate, "5");
  assert.equal(r2.objects.get("1.mp4")!.customMetadata.postedAt, "");
  assert.equal(r2.objects.get("1.mp4")!.contentType, "video/mp4");
});

test("poster storage uses the deterministic key and preserves image metadata", async () => {
  const { s, r2 } = mk();
  await s.putPoster("12345", new Response(new Uint8Array([0xff, 0xd8])).body!, "image/jpeg");
  assert.equal(await s.putPoster("12345", new Response(new Uint8Array([1])).body!, "image/png"), null, "an overlapping capture cannot overwrite the immutable poster");
  assert.equal(r2.objects.get("posters/12345")?.contentType, "image/jpeg");
  assert.ok(await s.getPoster("12345", new Headers()));
});

test("library metadata migrations default owner-managed fields to unset", async () => {
  const { s } = mk();
  await s.upsertBookmark(row());
  const b = (await s.getBookmark("1"))!;
  assert.deepEqual([b.title, b.description, b.favorite, b.tags, b.deleted_at], [null, null, 0, null, null]);
});

test("migration 0003: duration defaults to unknown and upsert preserves known duration", async () => {
  const { s } = mk();
  await s.upsertBookmark(row({ duration_ms: 65000 }));
  await s.upsertBookmark(row());
  assert.equal((await s.getBookmark("1"))?.duration_ms, 65000);
});

const dl = (s: Store, post_id: string, over: Partial<Parameters<Store["upsertBookmark"]>[0]> = {}) =>
  s.upsertBookmark(row({ post_id, status: "downloaded", r2_key: `${post_id}.mp4`, ...over }));

test("listLibrary filters by q and fav, sorts, and hides deleted rows", async () => {
  const { s } = mk();
  await dl(s, "1", { text: "cats on mars", posted_at: "2026-08-01T00:00:00Z", bytes: 20, duration_ms: 30000 });
  await dl(s, "2", { text: "dogs", posted_at: "2026-08-02T00:00:00Z", bytes: 10, duration_ms: 60000 });
  await dl(s, "3", { text: "zebra", posted_at: "2026-08-03T00:00:00Z" });
  await s.upsertBookmark(row({ post_id: "4", status: "pending", text: "cats pending" }));
  await s.updateMeta("2", { title: "Alpha", favorite: true }, "2026-08-30T00:00:00Z");
  await s.updateMeta("3", { description: "about CATS" }, "2026-08-30T00:00:00Z");
  const ids = async (q: Parameters<Store["listLibrary"]>[0] = {}) => (await s.listLibrary(q)).map((r) => r.post_id);
  assert.deepEqual(await ids(), ["3", "2", "1"], "newest first by posted_at");
  assert.deepEqual(await ids({ sort: "oldest" }), ["1", "2", "3"]);
  assert.deepEqual(await ids({ sort: "title" }), ["2", "1", "3"], "title falls back to text; case-insensitive");
  assert.deepEqual(await ids({ sort: "largest" }), ["1", "2", "3"], "unknown sizes sort last");
  assert.deepEqual(await ids({ sort: "smallest" }), ["2", "1", "3"], "unknown sizes sort last");
  assert.deepEqual(await ids({ sort: "longest" }), ["2", "1", "3"], "unknown durations sort last");
  assert.deepEqual(await ids({ sort: "shortest" }), ["1", "2", "3"], "unknown durations sort last");
  assert.deepEqual(await ids({ q: "cats" }), ["3", "1"], "matches text or description, not pending rows");
  assert.deepEqual(await ids({ fav: true }), ["2"]);
  assert.deepEqual(await ids({ q: "alpha", fav: true }), ["2"]);
  assert.ok(await s.markDeleted("3", "2026-08-30T01:00:00Z"));
  assert.deepEqual(await ids(), ["2", "1"], "deleted rows are hidden");
  assert.deepEqual(await ids({ q: "cats" }), ["1"]);
});

test("tags persist, participate in search, expose canonical video counts, and support exact AND filters", async () => {
  const { s, d1 } = mk();
  await dl(s, "1", { text: "first", now: "2026-08-02T00:00:00Z" });
  await dl(s, "2", { text: "second", posted_at: "2026-08-02T00:00:00Z" });
  await dl(s, "3", { text: "third", now: "2026-08-01T00:00:00Z", posted_at: "2026-08-03T00:00:00Z" });
  await s.updateMeta("1", { tags: ["Tutorial", "Design"] }, "2026-08-30T00:00:00Z");
  await s.updateMeta("2", { tags: ["Design systems"] }, "2026-08-30T00:00:00Z");
  await s.updateMeta("3", { tags: ["design"] }, "2026-08-30T00:00:00Z");
  assert.equal((await s.getBookmark("1"))!.tags, '["Tutorial","Design"]');
  d1.db.prepare("UPDATE bookmarks SET tags = ? WHERE post_id = ?").run('["Tutorial","Design","DESIGN"]', "1");
  assert.deepEqual(await s.listTags(), [
    { tag: "design", count: 2 }, { tag: "Design systems", count: 1 }, { tag: "Tutorial", count: 1 },
  ], "legacy case duplicates on one video count once");
  assert.deepEqual((await s.listLibrary({ tags: ["tutorial"] })).map((r) => r.post_id), ["1"]);
  assert.deepEqual((await s.listLibrary({ tags: ["Design"] })).map((r) => r.post_id), ["3", "1"], "exact tag filter does not match longer tags");
  assert.deepEqual((await s.listLibrary({ tags: ["Tutorial", "DESIGN"] })).map((r) => r.post_id), ["1"], "every selected tag must match");
  assert.deepEqual((await s.listLibrary({ q: "systems" })).map((r) => r.post_id), ["2"]);
  assert.equal(await s.countLibrary({ tags: ["DESIGN"] }), 2);
  await s.updateMeta("1", { tags: [] }, "2026-08-30T01:00:00Z");
  assert.equal((await s.getBookmark("1"))!.tags, null, "an empty tag list clears tags");
});

test("countLibrary matches filters and listLibrary returns an offset window", async () => {
  const { s } = mk();
  for (let i = 1; i <= 12; i++) await dl(s, String(i), { text: i % 2 ? "cats" : "dogs", posted_at: `2026-08-${String(i).padStart(2, "0")}T00:00:00Z` });
  await s.updateMeta("11", { favorite: true }, "2026-08-30T00:00:00Z");
  await s.updateMeta("9", { favorite: true }, "2026-08-30T00:00:00Z");
  assert.equal(await s.countLibrary(), 12);
  assert.equal(await s.countLibrary({ q: "cats" }), 6);
  assert.equal(await s.countLibrary({ q: "cats", fav: true }), 2);
  assert.deepEqual((await s.listLibrary({}, 3, 4)).map((r) => r.post_id), ["8", "7", "6"]);
  await s.markDeleted("12", "2026-09-02T00:00:00Z");
  assert.equal(await s.countLibrary(), 11, "deleted rows leave the count");
});

test("updateMeta is partial, stores empty strings as NULL, and touches only live downloaded rows", async () => {
  const { s } = mk();
  await dl(s, "1");
  await s.upsertBookmark(row({ post_id: "2", status: "pending" }));
  assert.ok(await s.updateMeta("1", { title: "T", description: "D" }, "2026-08-30T00:00:00Z"));
  assert.ok(await s.updateMeta("1", { favorite: true }, "2026-08-30T00:00:01Z"));
  let b = (await s.getBookmark("1"))!;
  assert.deepEqual([b.title, b.description, b.favorite, b.updated_at], ["T", "D", 1, "2026-08-30T00:00:01Z"]);
  assert.ok(await s.updateMeta("1", { title: "" }, "2026-08-30T00:00:02Z"));
  b = (await s.getBookmark("1"))!;
  assert.deepEqual([b.title, b.description, b.favorite], [null, "D", 1], "only the given field changes; '' → NULL");
  assert.equal(await s.updateMeta("2", { title: "x" }, "2026-08-30T00:00:03Z"), false, "pending rows are not editable");
  assert.equal(await s.updateMeta("9", { title: "x" }, "2026-08-30T00:00:03Z"), false, "unknown id");
  await s.markDeleted("1", "2026-08-30T00:00:04Z");
  assert.equal(await s.updateMeta("1", { title: "x" }, "2026-08-30T00:00:05Z"), false, "deleted rows are not editable");
});

test("markDeleted is idempotent and keeps the first timestamp; deleteVideos removes every sibling key", async () => {
  const { s, r2 } = mk();
  await dl(s, "1", { r2_key: "1-1.mp4" });
  for (const k of ["1-1.mp4", "1-2.mp4", "posters/1", "10.mp4"]) await r2.put(k, new Uint8Array([1]));
  assert.ok(await s.markDeleted("1", "2026-08-30T00:00:00Z"));
  assert.ok(await s.markDeleted("1", "2026-08-31T00:00:00Z"), "a repeat delete still reports a match");
  assert.equal((await s.getBookmark("1"))!.deleted_at, "2026-08-30T00:00:00Z");
  assert.equal(await s.markDeleted("2", "2026-08-30T00:00:00Z"), false, "unknown id");
  await s.deleteVideos("1");
  assert.deepEqual([...r2.objects.keys()], ["10.mp4"], "another post whose id shares the prefix survives");
});

test("stats groups rows by status, error and deleted; listByStatus is newest-updated first", async () => {
  const { s } = mk();
  await dl(s, "1", { bytes: 100 });
  await dl(s, "2", { bytes: 50 });
  await s.upsertBookmark(row({ post_id: "3", status: "failed", error: "too_large", now: "2026-08-03T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "4", status: "failed", error: "too_large", now: "2026-08-04T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "5", status: "failed", error: "http_403", now: "2026-08-05T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "6", status: "pending", now: "2026-08-06T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "7", status: "no_video", has_video: 0 }));
  await s.markDeleted("2", "2026-08-30T00:00:00Z");
  const st = (await s.stats()).map((r) => [r.status, r.error, r.deleted, r.n, r.bytes]);
  assert.deepEqual(st.sort(), [
    ["downloaded", null, 0, 1, 100], ["downloaded", null, 1, 1, 50], ["failed", "http_403", 0, 1, 0],
    ["failed", "too_large", 0, 2, 0], ["no_video", null, 0, 1, 0], ["pending", null, 0, 1, 0],
  ].sort());
  assert.deepEqual((await s.listByStatus(["pending", "failed"])).map((r) => r.post_id), ["6", "5", "4", "3"]);
});

test("listPendingIds returns the oldest pending rows first and respects its limit", async () => {
  const { s } = mk();
  await s.upsertBookmark(row({ post_id: "3", now: "2026-08-03T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "2", now: "2026-08-01T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "1", now: "2026-08-01T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "4", status: "failed", now: "2026-07-01T00:00:00Z" }));
  assert.deepEqual(await s.listPendingIds(2), ["1", "2"]);
});

test("recordSeen inserts a new row as pending and never touches an existing row (ADR-0023)", async () => {
  const { s } = mk();
  assert.equal(await s.recordSeen(row({ post_id: "1", now: "2026-10-31T00:00:00Z" })), true);
  assert.deepEqual([(await s.getBookmark("1"))!.status, (await s.getBookmark("1"))!.first_seen_at], ["pending", "2026-10-31T00:00:00Z"]);
  await s.upsertBookmark(row({ post_id: "2", status: "failed", error: "too_large", bytes: 9, now: "2026-08-01T00:00:00Z" }));
  await dl(s, "3");
  await s.upsertBookmark(row({ post_id: "4", now: "2026-08-02T00:00:00Z" }));
  await dl(s, "5"); await s.markDeleted("5", "2026-09-02T00:00:00Z");
  const before = await Promise.all(["1", "2", "3", "4", "5"].map((id) => s.getBookmark(id)));
  for (const id of ["1", "2", "3", "4", "5"]) assert.equal(await s.recordSeen(row({ post_id: id, now: "2026-10-31T01:00:00Z" })), false, id);
  assert.deepEqual(await Promise.all(["1", "2", "3", "4", "5"].map((id) => s.getBookmark(id))), before);
});

test("listQueue lists live pending rows in drain order and failed rows newest first; countQueue counts both", async () => {
  const { s, d1 } = mk();
  await s.upsertBookmark(row({ post_id: "3", now: "2026-08-03T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "2", now: "2026-08-01T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "1", now: "2026-08-01T00:00:00Z" }));
  // markDeleted only tombstones downloaded rows; write deleted_at directly to prove the filter anyway.
  await s.upsertBookmark(row({ post_id: "7", now: "2026-07-01T00:00:00Z" })); d1.db.exec("UPDATE bookmarks SET deleted_at = '2026-09-01T00:00:00Z' WHERE post_id = '7'");
  await s.upsertBookmark(row({ post_id: "4", status: "failed", error: "too_large", now: "2026-08-04T00:00:00Z" }));
  await s.upsertBookmark(row({ post_id: "5", status: "failed", error: "http_404", now: "2026-08-05T00:00:00Z" }));
  await dl(s, "6");
  const q = await s.listQueue();
  assert.deepEqual(q.pending.map((r) => r.post_id), await s.listPendingIds());
  assert.deepEqual(q.pending.map((r) => r.post_id), ["1", "2", "3"]);
  assert.deepEqual(q.failed.map((r) => r.post_id), ["5", "4"]);
  assert.deepEqual(await s.countQueue(), { pending: 3, failed: 2 });
});

test("listPosterSources selects live downloaded rows using a stable keyset", async () => {
  const { s } = mk();
  await dl(s, "11111", { preview_url: "https://pbs.twimg.com/a.jpg" });
  await dl(s, "22222", { preview_url: "https://pbs.twimg.com/b.jpg" });
  await dl(s, "33333", { preview_url: null });
  await s.markDeleted("11111", "2026-09-02T00:00:00Z");
  assert.deepEqual((await s.listPosterSources(null, 10)).map((x) => x.post_id), ["22222"]);
  assert.deepEqual(await s.listPosterSources("22222", 10), []);
});

test("retry resets a failed row to pending and clears its error; other rows untouched", async () => {
  const { s } = mk();
  await s.upsertBookmark(row({ post_id: "1", status: "failed", error: "too_large" }));
  await dl(s, "2");
  assert.ok(await s.retry("1", "2026-08-30T00:00:00Z"));
  const b = (await s.getBookmark("1"))!;
  assert.deepEqual([b.status, b.error, b.updated_at], ["pending", null, "2026-08-30T00:00:00Z"]);
  assert.equal(await s.retry("1", "2026-08-30T00:00:01Z"), false, "already pending");
  assert.equal(await s.retry("2", "2026-08-30T00:00:01Z"), false, "downloaded rows are not retried");
  assert.equal(await s.retry("9", "2026-08-30T00:00:01Z"), false, "unknown id");
});

test("retryAll resets every failed row to pending and returns the count; nothing else touched", async () => {
  const { s } = mk();
  await s.upsertBookmark(row({ post_id: "1", status: "failed", error: "too_large" }));
  await s.upsertBookmark(row({ post_id: "2", status: "failed", error: "http_403" }));
  await s.upsertBookmark(row({ post_id: "3", status: "pending" }));
  await dl(s, "4");
  assert.equal(await s.retryAll("2026-08-31T00:00:00Z"), 2);
  for (const id of ["1", "2"]) {
    const b = (await s.getBookmark(id))!;
    assert.deepEqual([b.status, b.error, b.updated_at], ["pending", null, "2026-08-31T00:00:00Z"], id);
  }
  assert.equal((await s.getBookmark("4"))!.status, "downloaded");
  assert.equal(await s.retryAll("2026-08-31T00:00:01Z"), 0, "nothing left to retry");
});
