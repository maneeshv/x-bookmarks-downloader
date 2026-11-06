export interface ReelItem {
  postId: string;
  videoKey: string;
  title: string;
  durationMs: number | null;
  hasPoster: boolean;
}

export interface ReelsSession {
  version: 1;
  rs: string;
  filterKey: string;
  libraryKey: string;
  ordered: string[];
  shuffled: string[];
  order: "ordered" | "shuffle";
  seed?: string;
  pin?: string;
  currentId: string | null;
  currentIndex: number;
  positions: Record<string, number>;
  muted: boolean;
  speed: number;
  paused: boolean;
}

export interface RestoreOptions {
  filterKey: string;
  libraryKey: string;
  at?: string;
  initialAt?: string;
  order: "ordered" | "shuffle";
  seed?: string;
  pin?: string;
  rs: string;
  newRs: string;
  hadSession: boolean;
  newSeed: string;
}

export interface ReelsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createReelsState() {
  // Keep runtime dependencies inside the factory: the renderer emits its source into the page.
  const idPattern = /^\d{5,25}$/;
  const seedPattern = /^(?!00000000)[0-9a-f]{8}$/;
  const sessionPattern = /^[0-9a-f]{32}$/;
  const storageKey = "reels:sessions:v1";
  const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const isId = (value: unknown): value is string => typeof value === "string" && idPattern.test(value);
  const isSeed = (value: unknown): value is string => typeof value === "string" && seedPattern.test(value);
  const sequence = (session: ReelsSession): string[] => session.order === "shuffle" ? session.shuffled : session.ordered;

  function shuffle(ids: string[], seed: string, pin?: string): string[] {
    let random = isSeed(seed) ? Number.parseInt(seed, 16) : 1;
    const unique = [...new Set(ids)].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    const pinned = pin !== undefined && unique.includes(pin);
    const result = unique.filter(id => !pinned || id !== pin);
    for (let i = result.length - 1; i > 0; i--) {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      random >>>= 0;
      const j = Math.floor(random / 4294967296 * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    if (pinned) result.unshift(pin!);
    return result;
  }

  function validateSession(value: unknown): ReelsSession | null {
    if (!isObject(value) || value.version !== 1 || typeof value.rs !== "string" || !sessionPattern.test(value.rs)) return null;
    if (typeof value.filterKey !== "string" || value.filterKey.length > 8192 || typeof value.libraryKey !== "string" || value.libraryKey.length > 8192) return null;
    const validIds = (list: unknown): list is string[] => Array.isArray(list) && list.length <= 1000 && list.every(isId) && new Set(list).size === list.length;
    if (!validIds(value.ordered) || !validIds(value.shuffled) || !isObject(value.positions)) return null;
    if (value.order !== "ordered" && value.order !== "shuffle") return null;
    if (typeof value.muted !== "boolean" || typeof value.paused !== "boolean" || ![0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(value.speed as number)) return null;
    if (value.seed !== undefined && !isSeed(value.seed)) return null;
    const membership = new Set(value.ordered);
    if (value.pin !== undefined && (!isId(value.pin) || !membership.has(value.pin) || value.shuffled[0] !== value.pin)) return null;
    if (value.seed !== undefined) {
      if (value.shuffled.length !== value.ordered.length || value.shuffled.some(id => !membership.has(id))) return null;
    } else if (value.shuffled.length || value.order === "shuffle" || value.pin !== undefined) return null;
    const active = value.order === "shuffle" ? value.shuffled : value.ordered;
    if (!Number.isInteger(value.currentIndex) || (active.length ? !isId(value.currentId) || active[value.currentIndex as number] !== value.currentId : value.currentId !== null || value.currentIndex !== -1)) return null;
    if (Object.keys(value.positions).length > 1000) return null;
    const positions: Record<string, number> = {};
    for (const [id, position] of Object.entries(value.positions)) {
      if (membership.has(id) && typeof position === "number" && Number.isFinite(position) && position >= 0) positions[id] = position;
    }
    return {
      version: 1, rs: value.rs, filterKey: value.filterKey, libraryKey: value.libraryKey,
      ordered: [...value.ordered], shuffled: [...value.shuffled], order: value.order,
      seed: value.seed as string | undefined, pin: value.pin as string | undefined,
      currentId: value.currentId as string | null, currentIndex: value.currentIndex as number,
      positions, muted: value.muted, speed: value.speed as number, paused: value.paused,
    };
  }

  function setOrder(session: ReelsSession, order: "ordered" | "shuffle", seed?: string, pin?: string): ReelsSession {
    const result = {...session, order};
    if (order === "shuffle") {
      const nextSeed = isSeed(seed) ? seed : session.seed ?? "00000001";
      const nextPin = pin && session.ordered.includes(pin) ? pin : undefined;
      if (!session.seed || (seed !== undefined && (nextSeed !== session.seed || nextPin !== session.pin))) {
        result.seed = nextSeed;
        result.pin = nextPin;
        result.shuffled = shuffle(session.ordered, nextSeed, nextPin);
      }
    }
    result.currentIndex = result.currentId === null ? -1 : sequence(result).indexOf(result.currentId);
    return result;
  }

  function restore(items: ReelItem[], options: RestoreOptions, stored?: ReelsSession | null): {
    session: ReelsSession; restored: boolean; notice: "refreshed" | "fallback" | "order-changed" | null;
  } {
    const eligible = new Set(items.map(item => item.postId));
    const validated = validateSession(stored);
    const saved = validated?.filterKey === options.filterKey && validated.rs === options.rs ? validated : null;
    const explicit = options.at && eligible.has(options.at) ? options.at : undefined;
    const refresh = !!saved && !!explicit && !saved.ordered.includes(explicit);
    if (!saved || refresh) {
      let session: ReelsSession = {
        version: 1, rs: refresh ? options.newRs : options.rs, filterKey: options.filterKey, libraryKey: options.libraryKey,
        ordered: [...eligible], shuffled: [], order: "ordered", currentId: null, currentIndex: -1,
        positions: {}, muted: true, speed: 1, paused: false,
      };
      session = setOrder(session, options.order, isSeed(options.seed) ? options.seed : options.newSeed, options.pin);
      session.currentId = explicit ?? (options.initialAt && eligible.has(options.initialAt) ? options.initialAt : sequence(session)[0] ?? null);
      session.currentIndex = session.currentId === null ? -1 : sequence(session).indexOf(session.currentId);
      return {session, restored: false, notice: refresh ? "refreshed" : options.hadSession ? "fallback" : null};
    }
    const ordered = saved.ordered.filter(id => eligible.has(id));
    const survivors = new Set(ordered);
    const oldSequence = sequence(saved);
    const successor = oldSequence.slice(saved.currentIndex + 1).find(id => survivors.has(id))
      ?? oldSequence.slice(0, saved.currentIndex).reverse().find(id => survivors.has(id));
    const currentId = explicit ?? (saved.currentId && survivors.has(saved.currentId) ? saved.currentId : successor ?? null);
    let session: ReelsSession = {
      ...saved, ordered, shuffled: saved.shuffled.filter(id => survivors.has(id)),
      pin: saved.pin && survivors.has(saved.pin) ? saved.pin : undefined,
      currentId, paused: true,
      positions: Object.fromEntries(Object.entries(saved.positions).filter(([id]) => survivors.has(id))),
    };
    let notice: "order-changed" | null = null;
    if (options.order === "shuffle") {
      const seed = isSeed(options.seed) ? options.seed : options.newSeed;
      const pin = options.pin && survivors.has(options.pin) ? options.pin : undefined;
      if (seed !== session.seed || pin !== session.pin) {
        session = {...session, seed, pin, shuffled: shuffle(ordered, seed, pin)};
        notice = "order-changed";
      }
    }
    session.order = options.order;
    session.currentIndex = currentId === null ? -1 : sequence(session).indexOf(currentId);
    return {session, restored: true, notice};
  }

  function clampPosition(position: number, durationSeconds: number): number {
    return Number.isFinite(position) && position >= 0 && Number.isFinite(durationSeconds) && durationSeconds > 0 && position < durationSeconds ? position : 0;
  }

  function storedSessions(storage: ReelsStorage): ReelsSession[] {
    const raw = storage.getItem(storageKey);
    if (raw === null) return [];
    if (raw.length > 512 * 1024) throw new Error("Invalid Reels storage size");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 3) throw new Error("Invalid Reels storage collection");
    const sessions = parsed.map(validateSession);
    if (sessions.some(session => !session) || new Set(sessions.map(session => session!.rs)).size !== sessions.length) throw new Error("Invalid Reels session");
    return sessions as ReelsSession[];
  }

  function read(storage: ReelsStorage, rs: string): {session: ReelsSession | null; available: boolean} {
    let session: ReelsSession | null = null;
    try {
      const sessions = storedSessions(storage);
      session = sessions.find(item => item.rs === rs) ?? null;
      if (session) storage.setItem(storageKey, JSON.stringify([...sessions.filter(item => item.rs !== rs), session]));
      return {session, available: true};
    } catch {
      return {session, available: false};
    }
  }

  function write(storage: ReelsStorage, value: ReelsSession): boolean {
    const session = validateSession(value);
    if (!session) return false;
    try {
      let sessions: ReelsSession[];
      try { sessions = storedSessions(storage); } catch { sessions = []; }
      storage.setItem(storageKey, JSON.stringify([...sessions.filter(item => item.rs !== session.rs), session].slice(-3)));
      return true;
    } catch {
      return false;
    }
  }

  return {shuffle, validateSession, restore, sequence, setOrder, clampPosition, read, write};
}
