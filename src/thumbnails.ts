import { DUPLICATE_HEAD_CONCURRENCY, DUPLICATE_SCAN_LIMIT, MAX_POSTER_BYTES } from "#src/limits";
import { posterKey, type BookmarkRow, type Store } from "#src/store";

export type ThumbnailItem = { row: BookmarkRow; poster: { bytes: number; md5: string } | null; reason: string | null };
export type ThumbnailScan = { items: ThumbnailItem[]; eligible: number; nextCursor: string | null; checkedAt: string };

async function inspectPoster(store: Store, row: BookmarkRow): Promise<ThumbnailItem> {
  try {
    const object = await store.r2.head(posterKey(row.post_id));
    if (!object) return { row, poster: null, reason: "missing_poster" };
    if (!Number.isSafeInteger(object.size) || object.size <= 0 || object.size > MAX_POSTER_BYTES
      || !["image/jpeg", "image/png", "image/webp"].includes(object.httpMetadata?.contentType ?? "")) {
      return { row, poster: null, reason: "unsupported_poster" };
    }
    const md5 = object.checksums?.md5;
    if (!(md5 instanceof ArrayBuffer) || md5.byteLength !== 16) return { row, poster: null, reason: "invalid_checksum" };
    return { row, poster: { bytes: object.size, md5: [...new Uint8Array(md5)].map(b => b.toString(16).padStart(2, "0")).join("") }, reason: null };
  } catch { return { row, poster: null, reason: "metadata_unavailable" }; }
}

export async function scanThumbnails(store: Store, after: string | null): Promise<ThumbnailScan> {
  const rows = await store.listThumbnailCandidates(after), eligible = await store.countThumbnailCandidates();
  const batch = rows.slice(0, DUPLICATE_SCAN_LIMIT), items: ThumbnailItem[] = new Array(batch.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(DUPLICATE_HEAD_CONCURRENCY, batch.length) }, async () => {
    while (next < batch.length) { const i = next++; items[i] = await inspectPoster(store, batch[i]!); }
  }));
  return { items, eligible, nextCursor: rows.length > DUPLICATE_SCAN_LIMIT ? batch.at(-1)!.post_id : null, checkedAt: new Date().toISOString() };
}
