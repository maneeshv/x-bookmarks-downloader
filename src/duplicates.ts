import { DUPLICATE_HEAD_CONCURRENCY, DUPLICATE_SCAN_LIMIT } from "#src/limits";
import type { BookmarkRow, Store } from "#src/store";

export type DuplicateCursor = { bytes: number; postId: string };
export type Fingerprint = { bytes: number; md5: string };
export type DuplicateItem = { row: BookmarkRow; fingerprint: Fingerprint | null; reason: string | null };
export type DuplicateScan = {
  items: DuplicateItem[];
  counts: { eligible: number; candidates: number; excluded: { multiVideo: number; error: number; unknownSize: number; invalidKey: number } };
  checkedAt: string;
  nextCursor: DuplicateCursor | null;
  trailingSizeComplete: boolean;
};
export type DuplicateResolve = { keep: string; remove: string; expected: Fingerprint };

export async function inspectDuplicate(store: Store, row: BookmarkRow): Promise<DuplicateItem> {
  try {
    const object = await store.r2.head(row.r2_key!);
    if (!object) return { row, fingerprint: null, reason: "missing_object" };
    if (!Number.isSafeInteger(object.size) || object.size <= 0 || object.size !== row.bytes) return { row, fingerprint: null, reason: "stale_size" };
    const md5 = object.checksums?.md5;
    if (!(md5 instanceof ArrayBuffer) || md5.byteLength !== 16) return { row, fingerprint: null, reason: "invalid_checksum" };
    return { row, fingerprint: { bytes: object.size, md5: [...new Uint8Array(md5)].map((b) => b.toString(16).padStart(2, "0")).join("") }, reason: null };
  } catch { return { row, fingerprint: null, reason: "metadata_unavailable" }; }
}

export async function scanDuplicates(store: Store, cursor: DuplicateCursor | null): Promise<DuplicateScan> {
  const rows = await store.listDuplicateCandidates(cursor), counts = await store.countDuplicates();
  const batch = rows.slice(0, DUPLICATE_SCAN_LIMIT), items: DuplicateItem[] = new Array(batch.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(DUPLICATE_HEAD_CONCURRENCY, batch.length) }, async () => {
    while (next < batch.length) { const index = next++; items[index] = await inspectDuplicate(store, batch[index]!); }
  }));
  const last = batch.at(-1), lookahead = rows[DUPLICATE_SCAN_LIMIT];
  return { items, counts, checkedAt: new Date().toISOString(), nextCursor: lookahead && last ? { bytes: last.bytes!, postId: last.post_id } : null,
    trailingSizeComplete: !lookahead || lookahead.bytes !== last?.bytes };
}

export function isDuplicateEligible(row: BookmarkRow | null): row is BookmarkRow {
  return !!row && row.status === "downloaded" && row.deleted_at === null && row.error === null && row.r2_key === `${row.post_id}.mp4`
    && Number.isSafeInteger(row.bytes) && (row.bytes ?? 0) > 0;
}

export async function validateDuplicateResolution(store: Store, request: DuplicateResolve): Promise<BookmarkRow | null> {
  const keeper = await store.getBookmark(request.keep), victim = await store.getBookmark(request.remove);
  if (!isDuplicateEligible(keeper) || !isDuplicateEligible(victim)) return null;
  for (const row of [keeper, victim]) {
    const { fingerprint } = await inspectDuplicate(store, row);
    if (!fingerprint || fingerprint.bytes !== request.expected.bytes || fingerprint.md5 !== request.expected.md5) return null;
    try {
      const siblings = await Promise.all([1, 2, 3, 4].map((n) => store.r2.head(`${row.post_id}-${n}.mp4`)));
      if (siblings.some((obj) => obj !== null)) return null;
    } catch { return null; }
  }
  return victim;
}

// R2 first, then tombstone, then once-only sequential accounting (ADR-0011).
// A cron tick or another tab can race this sequence; repeat DELETE cleans up late objects.
export async function deleteBookmark(store: Store, row: BookmarkRow): Promise<void> {
  await store.deleteVideos(row.post_id);
  await store.markDeleted(row.post_id, new Date().toISOString());
  if (!row.deleted_at) await store.patchStatus({ totalBytes: Math.max(0, ((await store.getStatus()).totalBytes ?? 0) - (row.bytes ?? 0)) });
}
