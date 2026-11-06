import { POST_ID_RE } from "#src/limits";
import { DEFAULT_LIBRARY_PAGE_SIZE, type LibraryQuery } from "#src/store";

export type ReelsContext = {
  library: LibraryQuery; from?: string; at?: string; order: "ordered" | "shuffle";
  seed: string; pin?: string; rs: string; hadSession: boolean;
};

export function parseReelsContext(url: URL, library: LibraryQuery): ReelsContext {
  const p = url.searchParams;
  const id = (name: string) => { const value = p.get(name); return value && POST_ID_RE.test(value) ? value : undefined; };
  const from = id("from"), order = p.get("order") === "shuffle" ? "shuffle" : "ordered";
  const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
  let seed = p.get("seed") ?? "";
  if (!/^[0-9a-f]{8}$/.test(seed) || seed === "00000000") {
    do { seed = randomHex(4); } while (seed === "00000000");
  }
  const incomingSession = p.get("rs") ?? "";
  return {
    library: from ? { ...library } : { ...library, page: 1, perPage: DEFAULT_LIBRARY_PAGE_SIZE },
    from, at: id("at"), order, seed, pin: order === "shuffle" ? id("pin") : undefined,
    rs: /^[0-9a-f]{32}$/.test(incomingSession) ? incomingSession : randomHex(16), hadSession: p.has("rs"),
  };
}

// Self-contained so the same canonical URL builders can be emitted into the client script.
export function createReelsUrls() {
  const validId = (id: string | undefined) => !!id && /^\d{5,25}$/.test(id);
  const libraryParams = (c: ReelsContext) => {
    const q = c.library, p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.fav) p.set("fav", "1");
    for (const tag of q.tags ?? []) p.append("tag", tag);
    if (q.sort && q.sort !== "newest") p.set("sort", q.sort);
    if (validId(c.from)) {
      if (q.page && q.page > 1) p.set("page", String(q.page));
      if (q.perPage && q.perPage !== 10) p.set("perPage", String(q.perPage));
    }
    return p;
  };
  const params = (c: ReelsContext) => {
    const p = libraryParams(c);
    if (validId(c.from)) p.set("from", c.from!);
    if (validId(c.at)) p.set("at", c.at!);
    p.set("order", c.order === "shuffle" ? "shuffle" : "ordered");
    if (/^[0-9a-f]{8}$/.test(c.seed) && c.seed !== "00000000") p.set("seed", c.seed);
    if (c.order === "shuffle" && validId(c.pin)) p.set("pin", c.pin!);
    if (/^[0-9a-f]{32}$/.test(c.rs)) p.set("rs", c.rs);
    return p;
  };
  return {
    href: (c: ReelsContext) => `/reels?${params(c)}`,
    watchHref: (postId: string, c: ReelsContext) => {
      if (!validId(postId)) return "/reels";
      const p = params({ ...c, at: postId }); p.set("view", "reels");
      return `/watch/${postId}?${p}`;
    },
    libraryHref: (c: ReelsContext) => {
      const query = libraryParams(c).toString();
      return `${query ? `/?${query}` : "/"}${validId(c.from) ? `#video-${c.from}` : ""}`;
    },
  };
}
const urls = createReelsUrls();
export const reelsHref = urls.href;
export const reelsWatchHref = urls.watchHref;
export const reelsLibraryHref = urls.libraryHref;
