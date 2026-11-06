import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "#src/store";
import { FakeD1, FakeKV, FakeR2 } from "#test/fakes";

export const row = (post_id: string, over: Partial<Parameters<Store["upsertBookmark"]>[0]> = {}) => ({
  post_id, posted_at: null, text: "video", post_url: `https://x.com/i/status/${post_id}`, has_video: 1 as const,
  status: "downloaded" as const, error: null, r2_key: `${post_id}.mp4`, bytes: 3, duration_ms: null, preview_url: null, now: "2026-11-06T00:00:00Z", ...over,
});
const setup = () => { const db = new FakeD1(), kv = new FakeKV(), r2 = new FakeR2(); return { db, kv, r2, store: new Store(kv.asKV(), db.asD1(), r2.asR2()) }; };

test("eligible equal-size candidates exclude live ineligible entries in precedence order", async () => {
  const a = setup();
  for (const id of ["10000", "10001"]) await a.store.upsertBookmark(row(id));
  await a.store.upsertBookmark(row("10002", { bytes: 8 }));
  await a.store.upsertBookmark(row("10003", { r2_key: "10003-1.mp4", error: "partial", bytes: null }));
  await a.store.upsertBookmark(row("10004", { error: "partial", bytes: null }));
  await a.store.upsertBookmark(row("10005", { r2_key: null, bytes: null }));
  for (const [i, bytes] of [null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].entries()) await a.store.upsertBookmark(row(String(10006 + i), { bytes }));
  await a.store.upsertBookmark(row("10011", { status: "pending" }));
  await a.store.upsertBookmark(row("10012")); await a.store.markDeleted("10012", "2026-11-06T00:00:00Z");
  assert.equal(typeof a.store.listDuplicateCandidates, "function");
  assert.deepEqual((await a.store.listDuplicateCandidates(null)).map((r) => r.post_id), ["10000", "10001"]);
  assert.deepEqual(await a.store.countDuplicates(), { eligible: 3, candidates: 2, excluded: { multiVideo: 1, error: 1, invalidKey: 1, unknownSize: 5 } });
});

test("101-candidate bucket completes across cursor; full membership survives final remaining row", async () => {
  const a = setup();
  for (let i = 10000; i < 10101; i++) { await a.store.upsertBookmark(row(String(i))); await a.r2.put(`${i}.mp4`, "abc"); }
  const { scanDuplicates } = await import("#src/duplicates");
  let heads = 0, active = 0, maxActive = 0; const head = a.r2.head.bind(a.r2);
  a.r2.head = async (key) => { heads++; active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 1)); try { return await head(key); } finally { active--; } };
  const first = await scanDuplicates(a.store, null);
  assert.equal(first.items.length, 100); assert.equal(heads, 100); assert.ok(maxActive <= 4 && maxActive > 1);
  assert.deepEqual(first.nextCursor, { bytes: 3, postId: "10099" }); assert.equal(first.trailingSizeComplete, false);
  const last = await scanDuplicates(a.store, first.nextCursor);
  assert.deepEqual(last.items.map((r) => r.row.post_id), ["10100"]); assert.equal(last.nextCursor, null); assert.equal(last.trailingSizeComplete, true);
  assert.equal(last.counts.candidates, 101); assert.match(last.checkedAt, /^2026-/);
});

test("library scans all candidates beyond 800 entries with bounded deterministic pages", async () => {
  const a = setup();
  for (let i = 10000; i < 10803; i++) await a.store.upsertBookmark(row(String(i), { bytes: i < 10801 ? 3 : 4 }));
  const { scanDuplicates } = await import("#src/duplicates");
  let cursor = null, ids: string[] = [], scans = 0;
  do { const batch = await scanDuplicates(a.store, cursor); cursor = batch.nextCursor; ids.push(...batch.items.map((r) => r.row.post_id)); assert.ok(batch.items.length <= 100); scans++; } while (cursor && scans < 12);
  assert.equal(ids.length, 803); assert.equal(new Set(ids).size, 803); assert.equal(scans, 9);
});

test("checksum scan uses explicit 16-byte MD5 and flags stale/missing/failed metadata without body reads", async () => {
  const a = setup();
  for (let i = 10000; i < 10010; i++) { await a.store.upsertBookmark(row(String(i))); await a.r2.put(`${i}.mp4`, i === 10002 ? "xyz" : "abc"); }
  a.r2.get = async () => { throw new Error("must not read body"); };
  const head = a.r2.head.bind(a.r2);
  a.r2.head = async (key) => {
    if (key === "10003.mp4") return { ...(await head(key))!, checksums: {} } as any;
    if (key === "10004.mp4") return { ...(await head(key))!, checksums: { md5: new ArrayBuffer(15) } } as any;
    if (key === "10005.mp4") return null;
    if (key === "10006.mp4") return { ...(await head(key))!, size: 4 };
    if (key === "10007.mp4") throw new Error("secret infrastructure detail");
    if (key === "10008.mp4") return { ...(await head(key))!, checksums: { md5: "900150983cd24fb0d6963f7d28e17f72" } } as any;
    if (key === "10009.mp4") return { ...(await head(key))!, checksums: { md5: new ArrayBuffer(0) } } as any;
    return head(key);
  };
  const { scanDuplicates } = await import("#src/duplicates");
  const result = await scanDuplicates(a.store, null);
  assert.deepEqual(result.items[0]!.fingerprint, { bytes: 3, md5: "900150983cd24fb0d6963f7d28e17f72" });
  assert.deepEqual(result.items[0]!.fingerprint, result.items[1]!.fingerprint);
  assert.notDeepEqual(result.items[0]!.fingerprint, result.items[2]!.fingerprint);
  assert.deepEqual(result.items.slice(3).map((r) => [r.fingerprint, r.reason]), [
    [null, "invalid_checksum"], [null, "invalid_checksum"], [null, "missing_object"], [null, "stale_size"], [null, "metadata_unavailable"], [null, "invalid_checksum"], [null, "invalid_checksum"],
  ]);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("different next size makes trailing bucket complete; Store failure remains a request error", async () => {
  const a = setup();
  for (let i = 10000; i < 10100; i++) await a.store.upsertBookmark(row(String(i)));
  for (const id of ["10100", "10101"]) await a.store.upsertBookmark(row(id, { bytes: 4 }));
  const { scanDuplicates } = await import("#src/duplicates");
  assert.equal((await scanDuplicates(a.store, null)).trailingSizeComplete, true);
  a.store.listDuplicateCandidates = async () => { throw new Error("db broken"); };
  await assert.rejects(scanDuplicates(a.store, null), /db broken/);
});
