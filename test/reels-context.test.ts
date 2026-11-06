import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReelsContext, createReelsUrls } from "#src/reels-context";

test("Reels context validates opaque values and canonicalizes direct entry return pages", () => {
  const c = parseReelsContext(new URL("https://example.test/reels?from=evil&at=12345&pin=12346&order=shuffle&seed=00000000&rs=BAD&returnUrl=https://evil.test"), { q: "x", page: 9, perPage: 50 });
  assert.equal(c.from, undefined);
  assert.equal(c.at, "12345");
  assert.equal(c.pin, "12346");
  assert.equal(c.library.page, 1);
  assert.equal(c.library.perPage, 10);
  assert.match(c.seed, /^[0-9a-f]{8}$/);
  assert.notEqual(c.seed, "00000000");
  assert.match(c.rs, /^[0-9a-f]{32}$/);
  assert.equal(c.hadSession, true);
  const urls = createReelsUrls();
  assert.equal(urls.libraryHref(c), "/?q=x");
  assert.doesNotMatch(urls.href(c), /evil|BAD|returnUrl/);
});

test("Reels URL factory works independently and preserves validated Library origin", () => {
  const c = parseReelsContext(new URL("https://example.test/watch/12347?from=12345&at=12346&pin=12346&order=shuffle&seed=1234abcd&rs="+"a".repeat(32)), { q: "cats & dogs", tags: ["One", "Two"], fav: true, sort: "oldest", page: 2, perPage: 20 });
  const urls = (new Function("return ("+createReelsUrls.toString()+")()"))() as ReturnType<typeof createReelsUrls>;
  const result = new URL(urls.watchHref("12347", c), "https://example.test");
  assert.equal(result.pathname, "/watch/12347");
  assert.equal(result.searchParams.get("view"), "reels");
  assert.equal(result.searchParams.get("at"), "12347");
  assert.equal(result.searchParams.get("rs"), "a".repeat(32));
  assert.equal(result.searchParams.get("seed"), "1234abcd");
  assert.equal(result.searchParams.get("pin"), "12346");
  assert.deepEqual(result.searchParams.getAll("tag"), ["One", "Two"]);
  const library = new URL(urls.libraryHref(c), "https://example.test");
  assert.equal(library.hash, "#video-12345");
  assert.equal(library.searchParams.get("page"), "2");
  const ordinary = parseReelsContext(new URL("https://example.test/reels?pin=12345&order=other&seed=ABCDEF12"), {});
  assert.equal(ordinary.order, "ordered");
  assert.equal(ordinary.pin, undefined);
  assert.equal(ordinary.hadSession, false);
});
