import { test } from "node:test";
import assert from "node:assert/strict";
import { createReelsState, type ReelItem, type RestoreOptions } from "#src/reels-state";

const state = createReelsState();
const ids = ["10000", "10001", "10002", "10003", "10004"];
const items = (list = ids): ReelItem[] => list.map(postId => ({postId, videoKey: `${postId}.mp4`, title: postId, durationMs: 60000, hasPoster: false}));
const options = (over: Partial<RestoreOptions> = {}): RestoreOptions => ({filterKey: "/?sort=newest", libraryKey: "/?page=2", order: "ordered", rs: "a".repeat(32), newRs: "b".repeat(32), hadSession: false, newSeed: "00000001", ...over});
const fresh = () => state.restore(items(), options()).session;

test("shuffle uses the version 1 fixed vector, independent of input order and duplicate IDs", () => {
  assert.deepEqual(state.shuffle([...ids].reverse().concat(ids[0]), "00000001"), ["10002", "10003", "10001", "10004", "10000"]);
  assert.deepEqual(state.shuffle(ids, "00000001", "10000"), ["10000", "10003", "10002", "10004", "10001"]);
  assert.deepEqual(state.shuffle(["100000", "99999"], "00000001"), ["100000", "99999"]);
});

test("fresh entry honors at, then the Library entry, and starts muted with no Watch positions", () => {
  const result = state.restore(items(), options({at: "10003", initialAt: "10001"}));
  assert.equal(result.session.currentId, "10003");
  assert.equal(result.session.muted, true);
  assert.equal(result.session.paused, false);
  assert.deepEqual(result.session.positions, {});
  assert.equal(state.restore(items(), options({at: "99999", initialAt: "10001"})).session.currentId, "10001");
});

test("reconcile retains snapshot order and preferences, excludes new matches, and returns paused", () => {
  const saved = {...fresh(), currentId: "10001", currentIndex: 1, positions: {"10001": 12}, muted: false, speed: 1.5};
  const result = state.restore(items(["10004", "10001", "10000", "10005"]), options({hadSession: true}), saved);
  assert.equal(result.restored, true);
  assert.deepEqual(result.session.ordered, ["10000", "10001", "10004"]);
  assert.equal(result.session.currentId, "10001");
  assert.deepEqual(result.session.positions, {"10001": 12});
  assert.equal(result.session.muted, false);
  assert.equal(result.session.speed, 1.5);
  assert.equal(result.session.paused, true);
});

test("URL at wins within snapshot; an eligible new at creates a new session without saved positions", () => {
  const saved = {...fresh(), positions: {"10000": 9}};
  assert.equal(state.restore(items(), options({at: "10003"}), saved).session.currentId, "10003");
  const result = state.restore(items([...ids, "10005"]), options({at: "10005", hadSession: true}), saved);
  assert.equal(result.notice, "refreshed");
  assert.equal(result.session.rs, "b".repeat(32));
  assert.equal(result.session.currentId, "10005");
  assert.deepEqual(result.session.positions, {});
  assert.equal(result.session.ordered.length, 6);
});

test("removed current uses first surviving successor then nearest predecessor, or empty", () => {
  const saved = {...fresh(), currentId: "10002", currentIndex: 2};
  assert.equal(state.restore(items(["10000", "10004"]), options({at: "10002"}), saved).session.currentId, "10004");
  assert.equal(state.restore(items(["10000", "10001"]), options(), saved).session.currentId, "10001");
  assert.equal(state.restore(items(["10005"]), options(), saved).session.currentId, null);
  assert.deepEqual(state.restore(items(["10005"]), options(), saved).session.ordered, []);
});

test("mode switches keep current time and reuse shuffle while URL seed changes rebuild over survivors", () => {
  const initial = {...fresh(), currentId: "10003", currentIndex: 3, positions: {"10003": 42}};
  const shuffled = state.setOrder(initial, "shuffle", "00000001", "10003");
  assert.equal(shuffled.shuffled[0], "10003");
  assert.equal(shuffled.currentIndex, 0);
  assert.deepEqual(shuffled.positions, {"10003": 42});
  const ordered = state.setOrder(shuffled, "ordered");
  assert.equal(ordered.currentIndex, 3);
  assert.deepEqual(state.setOrder(ordered, "shuffle").shuffled, shuffled.shuffled);
  const same = state.restore(items([...ids, "10005"]), options({order: "shuffle", seed: "00000001", pin: "10003"}), shuffled);
  assert.deepEqual(same.session.shuffled, shuffled.shuffled);
  const changed = state.restore(items([...ids, "10005"]), options({order: "shuffle", seed: "12345678"}), shuffled);
  assert.equal(changed.notice, "order-changed");
  assert.equal(changed.session.seed, "12345678");
  assert.equal(changed.session.shuffled.includes("10005"), false);
  assert.equal(changed.session.pin, undefined);
});

test("missing, mismatched and invalid sessions use fresh URL reconstruction with an honest fallback", () => {
  for (const saved of [null, {...fresh(), filterKey: "/?q=other"}, {...fresh(), version: 2}]) {
    const result = state.restore(items(), options({hadSession: true, order: "shuffle", seed: "00000001", at: "10004"}), saved as ReturnType<typeof fresh>);
    assert.equal(result.notice, "fallback");
    assert.equal(result.session.currentId, "10004");
    assert.deepEqual(result.session.shuffled, ["10002", "10003", "10001", "10004", "10000"]);
  }
});

test("session validation bounds sequences and rejects invalid IDs, controls and inconsistent indices", () => {
  for (const over of [{version: 2}, {rs: "x"}, {ordered: ["https://evil"]}, {ordered: ["10000", "10000"]}, {ordered: Array.from({length: 1001}, (_, i) => String(10000 + i))}, {muted: "false"}, {speed: 99}, {paused: 1}, {currentIndex: 3}, {seed: "00000000"}, {shuffled: ["10000"]}]) {
    assert.equal(state.validateSession({...fresh(), ...over}), null, JSON.stringify(over).slice(0, 80));
  }
  const clean = state.validateSession({...fresh(), title: "do not persist", positions: {"10000": 12, "10001": -1, "10002": Infinity, "99999": 9}})!;
  assert.deepEqual(clean.positions, {"10000": 12});
  assert.equal("title" in clean, false);
});

test("empty, singleton and full-size sessions round-trip, and direct shuffle starts at its first item", () => {
  for (const list of [[], ["10000"], Array.from({length: 1000}, (_, i) => String(10000 + i))]) {
    const session = state.restore(items(list), options({order: "shuffle", seed: "00000001"})).session;
    assert.deepEqual(state.validateSession(session), session);
    assert.equal(session.currentIndex, list.length ? 0 : -1);
    assert.equal(new Set(session.shuffled).size, list.length);
  }
  assert.equal(state.restore(items(), options({order: "shuffle", seed: "00000001"})).session.currentId, "10002");
});

test("positions never seek into unknown duration or at/past the end", () => {
  assert.equal(state.clampPosition(12, 60), 12);
  for (const [position, duration] of [[-1, 60], [Infinity, 60], [60, 60], [61, 60], [12, NaN], [12, Infinity], [12, 0]]) {
    assert.equal(state.clampPosition(position, duration), 0);
  }
});

test("storage keeps three LRU sessions, strips metadata and survives blocked or corrupt storage", () => {
  const values = new Map<string, string>();
  const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value);}};
  const sessions = ["a", "b", "c", "d"].map(c => ({...fresh(), rs: c.repeat(32)}));
  assert.equal(state.write(storage, {...sessions[0], title: "private metadata"} as typeof sessions[number]), true);
  assert.equal([...values.values()][0].includes("private metadata"), false);
  for (const session of sessions.slice(0, 3)) assert.equal(state.write(storage, session), true);
  assert.equal(state.read(storage, sessions[0].rs).session?.rs, sessions[0].rs);
  assert.equal(state.write(storage, sessions[3]), true);
  assert.equal(state.read(storage, sessions[1].rs).session, null);
  assert.equal(state.read(storage, sessions[2].rs).session?.rs, sessions[2].rs);
  const blocked = {getItem: () => {throw Error("blocked");}, setItem: () => {throw Error("blocked");}};
  assert.deepEqual(state.read(blocked, sessions[0].rs), {session: null, available: false});
  assert.equal(state.write(blocked, sessions[0]), false);
  storage.setItem([...values.keys()][0], "{broken");
  assert.deepEqual(state.read(storage, sessions[0].rs), {session: null, available: false});
  assert.equal(state.write(storage, sessions[0]), true);
  assert.equal(state.read(storage, sessions[0].rs).available, true);
});

test("emitted factory runs without module closures", () => {
  const emitted = new Function(`return (${createReelsState.toString()})()`)() as ReturnType<typeof createReelsState>;
  assert.deepEqual(emitted.shuffle(ids, "00000001"), ["10002", "10003", "10001", "10004", "10000"]);
  assert.equal(emitted.restore(items(), options()).session.currentId, "10000");
});
