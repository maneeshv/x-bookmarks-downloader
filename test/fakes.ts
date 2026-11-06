import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type Scripted = { status: number; body?: unknown; headers?: Record<string, string>; bodyBytes?: Uint8Array };
export type FakeFetch = typeof fetch & { calls: [string, RequestInit][] };

export function fakeFetch(script: Scripted[] | ((url: string, init: RequestInit) => Scripted)): FakeFetch {
  const calls: [string, RequestInit][] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push([url, init]);
    const s = typeof script === "function" ? script(url, init) : script.shift();
    if (!s) throw new Error(`fakeFetch: no scripted response for ${url}`);
    const headers = new Headers(s.headers ?? {});
    if (s.bodyBytes) return new Response(s.bodyBytes, { status: s.status, headers });
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new Response(s.body === undefined ? null : JSON.stringify(s.body), { status: s.status, headers });
  }) as unknown as FakeFetch;
  f.calls = calls;
  return f;
}

export const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", name), "utf8"));

// Same fileURLToPath+join pattern as fixture() — the Workers `URL` type clashes with Node's
// `readFileSync(URL)` overload under tsconfig.test.json. Every migration, in file-name order,
// so FakeD1 has the same columns as production (wrangler applies them the same way).
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
export const SCHEMA = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");

export class FakeKV {
  map = new Map<string, string>();
  async get(key: string, type?: "text" | "json"): Promise<unknown> {
    const v = this.map.get(key) ?? null;
    return v !== null && type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  asKV(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}

export class FakeR2 {
  objects = new Map<string, { bytes: Uint8Array; customMetadata: Record<string, string>; contentType: string; uploaded: Date }>();
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.bytes.byteLength, customMetadata: o.customMetadata, httpMetadata: { contentType: o.contentType }, checksums: { md5: Uint8Array.from(createHash("md5").update(o.bytes).digest()).buffer } } : null;
  }
  async put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string, opts: any = {}) {
    if (opts.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) return null;
    const bytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
    // ponytail: a fixed fake upload time (not real put-time) is all If-Modified-Since needs to test against.
    this.objects.set(key, { bytes, customMetadata: opts.customMetadata ?? {}, contentType: opts.httpMetadata?.contentType ?? "", uploaded: new Date("2026-08-01T00:00:00Z") });
    return { key, size: bytes.byteLength };
  }
  async delete(keys: string | string[]) {
    for (const k of [keys].flat()) this.objects.delete(k);
  }
  async get(key: string, opts: { range?: Headers; onlyIf?: Headers } = {}) {
    // ponytail: magic key for the "generic R2 fault must propagate" test — real R2 can throw for
    // reasons other than an unsatisfiable Range (network fault, internal error).
    if (key === "99999.mp4" || key === "posters/99999") throw new Error("boom");
    const o = this.objects.get(key);
    if (!o) return null;
    const httpEtag = `"${key}"`;
    const m = /bytes=(\d+)-(\d*)/.exec(opts.range?.get("range") ?? "");
    const start = m ? Number(m[1]) : 0,
      end = m && m[2] ? Number(m[2]) + 1 : o.bytes.byteLength;
    // real R2 throws on an unsatisfiable range (start at/past the object's size).
    if (m && start >= o.bytes.byteLength) throw new RangeError("Requested Range Not Satisfiable");
    const base = {
      key,
      size: o.bytes.byteLength,
      httpEtag,
      // real R2 always reports the served range, {0, size} for a plain GET — not just on Range requests.
      // Real R2 returns all three keys, unused ones undefined — code must not use `"suffix" in range`.
      range: { offset: start, length: end - start, suffix: undefined } as R2Range,
      writeHttpMetadata: (h: Headers) => {
        h.set("content-type", o.contentType);
      },
    };
    // real R2 drops the body when an onlyIf conditional matches: If-None-Match hit, or
    // If-Modified-Since at/after the object's (fake) upload time.
    const ims = opts.onlyIf?.get("if-modified-since");
    const notModifiedSince = ims && !isNaN(Date.parse(ims)) && new Date(ims) >= o.uploaded;
    if (opts.onlyIf?.get("if-none-match") === httpEtag || notModifiedSince) return base;
    return { ...base, body: new Response(o.bytes.slice(start, end)).body };
  }
  asR2(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}

export async function makeSigner(kid = "kid1") {
  // workerd's ambient SubtleCrypto.generateKey (worker-configuration.d.ts) has one
  // un-discriminated overload returning `CryptoKey | CryptoKeyPair`; RSASSA-PKCS1-v1_5
  // with usages ["sign", "verify"] always yields a pair at runtime.
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid, alg: "RS256", use: "sig" };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return {
    jwk,
    async sign(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid, typ: "JWT" }) {
      const signing = `${enc(header)}.${enc(payload)}`;
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(signing));
      return `${signing}.${Buffer.from(sig).toString("base64url")}`;
    },
  };
}

export class FakeD1 {
  db = new DatabaseSync(":memory:");
  constructor(schema = SCHEMA) {
    this.db.exec(schema);
  }
  prepare(sql: string) {
    const db = this.db;
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        args = a.map((x) => (x === undefined ? null : x));
        return stmt;
      },
      async run() {
        // Real D1 reports meta.changes (developers.cloudflare.com/d1/worker-api/return-object/#d1result); node:sqlite does too.
        const r = db.prepare(sql).run(...(args as never[]));
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...(args as never[])) as T[] };
      },
      async first<T>() {
        return ((db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null);
      },
    };
    return stmt;
  }
  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}
