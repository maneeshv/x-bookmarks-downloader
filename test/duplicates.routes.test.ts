import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, type AppEnv } from "#src/index";
import { Store } from "#src/store";
import { FakeD1, FakeKV, FakeR2, fakeFetch, makeSigner } from "#test/fakes";

const ORIGIN = "https://w.example", TEAM = "https://duplicates.cloudflareaccess.com";
const expected = { bytes: 3, md5: "900150983cd24fb0d6963f7d28e17f72" };
const payload = { keep: "10000", remove: "10001", expected };
const SCAN = "/api/duplicates/scan", RESOLVE = "/api/duplicates/resolve";
async function app() {
  const kv = new FakeKV(), db = new FakeD1(), r2 = new FakeR2(), signer = await makeSigner(crypto.randomUUID());
  const f = fakeFetch(() => ({ status: 200, body: { keys: [signer.jwk] } }));
  const env: AppEnv = { X_CLIENT_ID: "c", X_CLIENT_SECRET: "s", TEAM_DOMAIN: TEAM, POLICY_AUD: "a", PUBLIC_ORIGIN: ORIGIN, OWNER_EMAIL: "owner@example.com", VIDEOS: r2.asR2(), DB: db.asD1(), KV: kv.asKV() };
  const jwt = await signer.sign({ aud: ["a"], iss: TEAM, exp: Date.now() / 1000 + 3600, email: "owner@example.com" });
  const viewer = await signer.sign({ aud: ["a"], iss: TEAM, exp: Date.now() / 1000 + 3600, email: "viewer@example.com" });
  const send = (path: string, init: RequestInit = {}, token: string | null = jwt) => handle(new Request(ORIGIN + path, { ...init, headers: { ...(token ? { "cf-access-jwt-assertion": token } : {}), ...Object.fromEntries(new Headers(init.headers)) } }), env, f);
  const post = (body: unknown = payload) => send(RESOLVE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const store = new Store(kv.asKV(), db.asD1(), r2.asR2());
  for (const post_id of ["10000", "10001"]) {
    await store.upsertBookmark({ post_id, posted_at: null, text: "video", post_url: `https://x.com/i/status/${post_id}`, has_video: 1, status: "downloaded", error: null, r2_key: `${post_id}.mp4`, bytes: 3, duration_ms: null, preview_url: null, now: "2026-11-06T00:00:00Z" });
    await r2.put(`${post_id}.mp4`, "abc");
  }
  await r2.put("posters/10001", "poster");
  await store.patchStatus({ totalBytes: 6 });
  return { kv, db, r2, store, env, send, post, viewer };
}
const assertPrivate = (res: Response) => assert.equal(res.headers.get("cache-control"), "private, no-store");
const assertSafeError = async (res: Response, status: number) => { assert.equal(res.status, status); assertPrivate(res); assert.match(res.headers.get("content-type") ?? "", /application\/json/); assert.equal(typeof (await res.json() as { error: unknown }).error, "string"); };

test("duplicate page and APIs require owner before any D1/R2 reads", async () => {
  const a = await app();
  a.db.prepare = () => { throw new Error("must not read"); }; a.r2.head = async () => { throw new Error("must not read"); };
  for (const token of [a.viewer, null]) for (const path of ["/duplicates", SCAN, RESOLVE]) assert.equal((await a.send(path, {}, token)).status, 403);
});

test("page and scan use private no-store; page does not scan or query rows", async () => {
  const a = await app();
  const scan = await a.send(SCAN); assert.equal(scan.status, 200); assertPrivate(scan); assert.equal((await scan.json() as { items: unknown[] }).items.length, 2);
  a.db.prepare = () => { throw new Error("no page query"); }; a.r2.head = async () => { throw new Error("no page HEAD"); };
  const page = await a.send("/duplicates"); assert.equal(page.status, 200); assertPrivate(page); assert.match(await page.text(), /[Dd]uplicates/);
  await assertSafeError(await a.send("/duplicates", { method: "POST" }), 405);
});

test("scan cursor validates both safe size and ID; malformed and duplicated parameters fail before reads", async () => {
  const a = await app();
  for (const query of ["afterBytes=3", "afterPostId=10000", "afterBytes=0&afterPostId=10000", "afterBytes=1.5&afterPostId=10000", "afterBytes=9007199254740992&afterPostId=10000", "afterBytes=3&afterPostId=bad", "afterBytes=&afterPostId=10000", "afterBytes=3&afterBytes=4&afterPostId=10000", "afterBytes=3&afterPostId=10000&afterPostId=10001"]) await assertSafeError(await a.send(`${SCAN}?${query}`), 400);
  const res = await a.send(`${SCAN}?afterBytes=3&afterPostId=10000`); assert.equal(res.status, 200); assert.deepEqual((await res.json() as { items: { row: { post_id: string } }[] }).items.map((i) => i.row.post_id), ["10001"]);
  await assertSafeError(await a.send(SCAN, { method: "POST" }), 405);
});

test("resolve validates method, JSON content type, body and fingerprint without mutation", async () => {
  const a = await app();
  await assertSafeError(await a.send(RESOLVE), 405);
  for (const contentType of ["text/plain", "application/jsonp", "application/json-malformed"]) await assertSafeError(await a.send(RESOLVE, { method: "POST", headers: { "content-type": contentType }, body: "{}" }), 415);
  await assertSafeError(await a.send(RESOLVE, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }), 400);
  for (const body of [null, [], {}, { ...payload, keep: "bad" }, { ...payload, remove: payload.keep }, { ...payload, remove: ["10001"] }, { ...payload, expected: null }, { ...payload, expected: { ...expected, bytes: 0 } }, { ...payload, expected: { ...expected, bytes: 1.5 } }, { ...payload, expected: { ...expected, md5: "X".repeat(32) } }]) await assertSafeError(await a.post(body), 400);
  assert.equal(a.r2.objects.size, 3); assert.equal((await a.store.getBookmark("10001"))!.deleted_at, null);
});

test("guarded resolution deletes only victim with existing tombstone and once-only counter semantics", async () => {
  const a = await app();
  await a.store.updateMeta("10001", { title: "owner title", tags: ["tag"], favorite: true, resume_ms: 2000 }, "2026-11-06T00:00:00Z");
  const res = await a.post(); assert.equal(res.status, 204); assertPrivate(res);
  assert.deepEqual([...a.r2.objects.keys()], ["10000.mp4"]);
  const victim = (await a.store.getBookmark("10001"))!; assert.ok(victim.deleted_at); assert.equal(victim.title, "owner title"); assert.equal(victim.tags, '["tag"]');
  assert.equal((await a.store.getStatus()).totalBytes, 3);
  await assertSafeError(await a.post(), 409); assert.equal((await a.store.getStatus()).totalBytes, 3);
  assert.equal((await a.send("/api/videos/10001", { method: "DELETE" })).status, 204); assert.equal((await a.store.getStatus()).totalBytes, 3);
});

test("live eligible rows, matching actual MD5/size and expected fingerprint required for both posts", async () => {
  const a = await app();
  for (const id of ["10000", "10001"]) {
    for (const update of ["deleted_at = '2026-11-06'", "status = 'pending'", "error = 'partial'", "r2_key = 'bad.mp4'", "bytes = NULL", "bytes = 4"]) {
      a.db.db.exec(`UPDATE bookmarks SET ${update} WHERE post_id = '${id}'`);
      await assertSafeError(await a.post(), 409);
      a.db.db.exec(`UPDATE bookmarks SET deleted_at = NULL, status = 'downloaded', error = NULL, r2_key = '${id}.mp4', bytes = 3 WHERE post_id = '${id}'`);
      assert.equal(a.r2.objects.size, 3);
    }
    await a.r2.delete(`${id}.mp4`); await assertSafeError(await a.post(), 409); await a.r2.put(`${id}.mp4`, "xyz"); await assertSafeError(await a.post(), 409); await a.r2.put(`${id}.mp4`, "abcd"); await assertSafeError(await a.post(), 409); await a.r2.put(`${id}.mp4`, "abc");
  }
  await assertSafeError(await a.post({ ...payload, expected: { ...expected, md5: "0".repeat(32) } }), 409);
  await assertSafeError(await a.post({ ...payload, expected: { ...expected, bytes: 4 } }), 409);
  await assertSafeError(await a.post({ ...payload, keep: "99999" }), 409);
});

test("each of four hidden siblings on either post blocks cleanup without any write", async () => {
  const a = await app();
  for (const id of ["10000", "10001"]) for (let n = 1; n <= 4; n++) {
    const key = `${id}-${n}.mp4`; await a.r2.put(key, "unique"); await assertSafeError(await a.post(), 409);
    assert.ok(a.r2.objects.has("10001.mp4")); assert.equal((await a.store.getBookmark("10001"))!.deleted_at, null); await a.r2.delete(key);
  }
});

test("missing checksum and failed reads including sibling checks reject without leaking errors", async () => {
  const a = await app(), head = a.r2.head.bind(a.r2);
  for (const key of ["10000.mp4", "10001.mp4", "10000-1.mp4", "10001-4.mp4"]) {
    a.r2.head = async (k) => { if (k === key) throw new Error("secret"); return head(k); };
    const res = await a.post(); assert.equal(res.status, 409); assertPrivate(res); assert.ok(!(await res.text()).includes("secret"));
  }
  a.r2.head = async (key) => { const obj = await head(key); return obj ? { ...obj, checksums: {} } as any : null; };
  await assertSafeError(await a.post(), 409); assert.equal(a.r2.objects.size, 3);
});

test("scan infrastructure failure gives safe private JSON server error", async () => {
  const a = await app(); a.db.prepare = () => { throw new Error("secret DB detail"); };
  const res = await a.send(SCAN); assert.equal(res.status, 500); assertPrivate(res); assert.ok(!(await res.text()).includes("secret"));
});

test("failures during R2, tombstone and counter writes are server errors and preserve partial outcomes", async () => {
  for (const stage of ["r2", "tombstone", "counter"]) {
    const a = await app();
    if (stage === "r2") a.r2.delete = async () => { throw new Error("secret"); };
    if (stage === "tombstone") { const prepare = a.db.prepare.bind(a.db); a.db.prepare = (sql) => { if (sql.startsWith("UPDATE bookmarks SET deleted_at")) throw new Error("secret"); return prepare(sql); }; }
    if (stage === "counter") a.kv.put = async () => { throw new Error("secret"); };
    const res = await a.post(); assert.equal(res.status, 500, stage); assertPrivate(res); assert.ok(!(await res.text()).includes("secret"));
    assert.ok(a.r2.objects.has("10000.mp4")); assert.equal(a.r2.objects.has("10001.mp4"), stage === "r2");
    assert.equal(Boolean((await a.store.getBookmark("10001"))!.deleted_at), stage === "counter");
    assert.equal((await a.store.getStatus()).totalBytes, 6);
  }
});
