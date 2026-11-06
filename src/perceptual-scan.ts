import type { createPerceptualTools, PosterHash } from '#src/perceptual';
import type { ThumbnailItem, ThumbnailScan } from '#src/thumbnails';
export type SimilarPair = { a: ThumbnailItem; b: ThumbnailItem; aPreview: string; bPreview: string; distance: number; similarity: number };
export type SimilarProgress = { checked: number; eligible: number; hashed: number; skipped: number; bytes: number; pairs: number; comparisons: number; status: 'running' | 'complete' | 'cancelled' | 'limited' | 'failed'; message: string };
export type PosterRequest = { signal: AbortSignal; credentials: 'same-origin'; redirect: 'error'; cache: 'no-store' };
type Platform = { fetch(url: string, init: PosterRequest): Promise<Response>; decode(data: Uint8Array, mime: string, dimensions: {width: number; height: number}): Promise<{ data: Uint8ClampedArray; width: number; height: number; preview?: string }>; yield(): Promise<void> };
type Options = { signal: AbortSignal; onProgress(progress: SimilarProgress): void; onPair(pair: SimilarPair): void; excludePair?(a: string, b: string): boolean };

// Serialized into the page with explicit dependencies; no storage or mutation API.
export function createPerceptualScanner(tools: ReturnType<typeof createPerceptualTools>, platform: Platform) {
  return {
    async request(url: string, expected: number | null, signal: AbortSignal, onBytes: (n: number) => void): Promise<Uint8Array | ThumbnailScan> {
      const controller = new AbortController();
      const relay = { abort() { controller.abort(); } };
      signal.addEventListener('abort', relay.abort, { once: true });
      if (signal.aborted) controller.abort();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await platform.fetch(url, { signal: controller.signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
        if (!response.ok) { await response.body?.cancel(); throw new Error('request'); }
        if (expected === null) {
          if (!response.headers.get('content-type')?.startsWith('application/json')) { await response.body?.cancel(); throw new Error('metadata'); }
          return await response.json() as ThumbnailScan;
        }
        const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        if (!['image/jpeg','image/png','image/webp'].includes(mime) || !response.body) { await response.body?.cancel(); throw new Error('poster'); }
        const length = response.headers.get('content-length');
        if (length !== null && Number(length) !== expected) { await response.body.cancel(); throw new Error('changed'); }
        const reader = response.body.getReader(), parts: Uint8Array[] = []; let lengthRead = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            // A network chunk may overshoot: count it honestly, then stop immediately.
            onBytes(value.byteLength); lengthRead += value.byteLength;
            if (lengthRead > expected || controller.signal.aborted) throw new Error('size');
            parts.push(value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        if (lengthRead !== expected) throw new Error('changed');
        const bytes = new Uint8Array(lengthRead); let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
        // Keep validated MIME alongside the bytes without trusting a URL extension.
        return Object.assign(bytes, { mime });
      } finally { clearTimeout(timer); signal.removeEventListener('abort', relay.abort); }
    },
    async run(options: Options): Promise<SimilarProgress> {
      const progress: SimilarProgress = { checked: 0, eligible: 0, hashed: 0, skipped: 0, bytes: 0, pairs: 0, comparisons: 0, status: 'running', message: '' };
      const seen = new Set<string>(), hashes: { entry: ThumbnailItem; hash: PosterHash; key: string; preview: string }[] = [], cache = new Map<string, {hash: PosterHash | null; preview: string}>();
      const counters = { bytes(n: number) { progress.bytes += n; } };
      let cursor: string | null = null;
      try {
        scan: do {
          if (options.signal.aborted) break;
          if (progress.checked >= tools.limits.entries) { progress.status = 'limited'; progress.message = 'Entry limit reached.'; break; }
          const batch = await this.request('/api/duplicates/thumbnails' + (cursor ? '?afterPostId=' + encodeURIComponent(cursor) : ''), null, options.signal, () => {}) as ThumbnailScan;
          progress.eligible = batch.eligible;
          for (const entry of batch.items) {
            if (options.signal.aborted) break scan;
            if (progress.checked >= tools.limits.entries) { progress.status = 'limited'; progress.message = 'Entry limit reached.'; break scan; }
            const id = entry.row.post_id;
            if (seen.has(id)) continue;
            if (!/^\d{5,25}$/.test(id)) throw new Error('metadata');
            const poster = entry.poster, key = poster ? poster.bytes + ':' + poster.md5 : '';
            let hash: PosterHash | null = null, preview = '';
            if (poster && Number.isSafeInteger(poster.bytes) && poster.bytes > 0 && poster.bytes <= tools.limits.imageBytes && /^[a-f0-9]{32}$/.test(poster.md5)) {
              if (cache.has(key)) ({hash,preview} = cache.get(key)!);
              else {
                if (progress.bytes + poster.bytes > tools.limits.bytes) { progress.status = 'limited'; progress.message = 'Thumbnail transfer limit reached.'; break scan; }
                try {
                  const bytes = await this.request('/p/' + id, poster.bytes, options.signal, counters.bytes) as Uint8Array & { mime: string };
                  const dimensions = tools.dimensions(bytes, bytes.mime);
                  if (dimensions && !options.signal.aborted) {
                    const pixels = await platform.decode(bytes, bytes.mime, dimensions);
                    // Orientation may swap width/height. Validate actual output independently.
                    if (!options.signal.aborted) {hash = tools.fingerprint(pixels.data, pixels.width, pixels.height);preview = pixels.preview ?? '';}
                  }
                  cache.set(key, {hash,preview});
                } catch { if (options.signal.aborted) break scan; }
              }
            }
            if (options.signal.aborted) break scan;
            seen.add(id); progress.checked++;
            if (hash) {
              progress.hashed++;
              for (const previous of hashes) {
                if (key === previous.key || options.excludePair?.(previous.entry.row.post_id, id)) continue;
                progress.comparisons++;
                const match = tools.compare(previous.hash, hash);
                if (match) {
                  progress.pairs++; options.onPair({ a: previous.entry, b: entry, aPreview: previous.preview, bPreview: preview, ...match });
                  if (progress.pairs >= tools.limits.pairs) { progress.status = 'limited'; progress.message = 'Suggestion limit reached.'; break scan; }
                }
              }
              hashes.push({ entry, hash, key, preview });
            } else progress.skipped++;
            options.onProgress({ ...progress });
            await platform.yield();
          }
          if (batch.nextCursor && batch.nextCursor === cursor) throw new Error('cursor');
          cursor = batch.nextCursor;
        } while (cursor);
        if (options.signal.aborted) { progress.status = 'cancelled'; progress.message = 'Cancelled. Results are partial.'; }
        else if (progress.status === 'running') { progress.status = 'complete'; progress.message = progress.skipped ? 'Finished with skipped thumbnails; coverage is partial.' : 'Scan complete.'; }
      } catch { progress.status = options.signal.aborted ? 'cancelled' : 'failed'; progress.message = 'Scan stopped. Results are partial; start again to retry.'; }
      options.onProgress({ ...progress }); return progress;
    },
  };
}
