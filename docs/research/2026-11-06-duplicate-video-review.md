# Duplicate video review feasibility
Date: 2026-11-06. Source checkout: `1ed0d7d`. Investigation only; implementation is not approved.

## Conclusion
A small owner-only `/duplicates` page is worthwhile. Start with equal-size, ordinary single-video D1 entries, verify their R2 MD5 checksums on demand, and show groups with previews and explicit keep/delete selection. No migration, dependency, persisted checksum index, or download-path change is needed for this scope.

## Existing behavior
- `src/x.ts:33`: object names contain the **post ID**, not the X media ID or original filename. Different posts get different keys even for identical content.
- `src/sync.ts:155`: existence checks prevent repeated downloads of the same key; there is no cross-post content deduplication.
- `src/store.ts:245`: `putVideo` streams one `R2.put` and discards its returned object. D1 has no content-checksum column. Stored custom metadata includes post information and bitrate, but not source media URL, media key, or an application-computed checksum.
- `src/sync.ts:154`: D1 has one row per post, `r2_key` points to the first stored video, and `bytes` sums stored sibling videos. Duration describes the playable video.
- `src/store.ts:236` and `src/index.ts:172`: deletion removes every possible video key of a post plus its poster, then tombstones the post and adjusts storage accounting. It cannot safely delete an individual duplicate attachment while preserving unique siblings.

## Read-only production evidence
Queried D1 and R2 metadata on 2026-11-06. No video bodies were downloaded and no application data was changed.

- D1: 397 live downloaded posts, 110,499,971,067 video bytes; 4 tombstoned posts; 62 no-video posts; no pending/failed rows in this snapshot.
- All 397 live rows were ordinary single-video entries without an error. The R2 response returned 794 objects, including 397 unsuffixed video objects. Every live D1 video key was present; every corresponding size matched D1. This verifies coverage of the live library snapshot, not an atomic bucket-wide inventory.
- Eight equal-size pairs (16 files) were candidates. Six pairs also had identical R2 ETags; two pairs had different ETags and must not be treated as exact matches merely because their sizes match.

| Bytes per file | Copies | R2 ETags |
|---:|---:|---|
| 265,164,063 | 2 | Match |
| 223,185,191 | 2 | Match |
| 137,300,232 | 2 | Match |
| 105,351,566 | 2 | Match |
| 34,459,987 | 2 | Match |
| 7,199,103 | 2 | Match |
| 391,460,088 | 2 | Different |
| 388,598,368 | 2 | Different |

Keeping one copy of each matching-ETag pair represents **772,660,142 potentially recoverable video bytes** (about 773 MB / 737 MiB), excluding posters. These are strong duplicate candidates, not a byte-by-byte comparison. The REST inventory exposed ETag, not the Workers `checksums.md5` field; that field must be checked before enabling cleanup. All returned video ETags had 32 hexadecimal digits without a multipart suffix; their shape alone is not proof of a full-content checksum.

Reproduce the candidate query with `wrangler d1 execute x-downloader --remote --json --command` and this read-only SQL:

```sql
SELECT bytes, COUNT(*) AS n
FROM bookmarks
WHERE status = 'downloaded' AND deleted_at IS NULL AND error IS NULL
  AND r2_key = post_id || '.mp4' AND bytes > 0
GROUP BY bytes HAVING COUNT(*) > 1
ORDER BY bytes;
```

The installed `cf r2 objects list --bucket-name <bucket> --per-page 1000` command exposes the REST metadata endpoint. Follow its pagination contract for a larger bucket; do not infer complete coverage merely from a short page. The Workers implementation should use its binding, not CLI credentials.

## Platform evidence
Retrieved through Context7 (`/websites/developers_cloudflare_r2`) and checked against the official reference on 2026-11-06:

1. [Workers R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/): `head` returns an `R2Object` containing metadata; `R2Object.checksums` contains stored checksums. **MD5 is included by default for non-multipart objects.** Other checksums are available when supplied during upload. This supports reusing R2 metadata instead of fetching or hashing video bodies.
2. [Multipart ETags](https://developers.cloudflare.com/r2/objects/upload-objects/#etags): multipart ETags hash the concatenated part hashes and append a part count. Do not equate a generic ETag with a whole-file MD5.
3. [Workers list options](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2listoptions): list pages can contain fewer objects than requested; use `truncated` and `cursor`. The minimal D1-first proposal does not require a bucket list operation.

## Committee and resolved differences
Participants: Claude Opus 5.5 and GPT-6.1-Sol, each at high reasoning through Paseo, plus the parent investigation. No configured agent profiles were available. Both reviewed the code and agreed on exact matching, manual cleanup, checksum reuse, and excluding multi-video deletion.

Sol initially preferred an R2 inventory, including review-only multi-video matches. Opus preferred a D1 size prefilter. After exchanging arguments and the live D1 evidence, both converged on **D1-first for the small-change v1**, with R2 inventory as a later extension. Neither recommends a fingerprint table or perceptual processing before measuring a need. A suggested keeper can be a hint; nothing should be selected for deletion automatically.

The parent corrected the assumption that the library is capped at 800 rows: that is X's retrieval window, not the accumulated library size. Both accepted bounded, resumable scanning. The parent also distinguishes the live ETag evidence above from the still-unverified production Workers MD5 field.

## Recommended scope for owner review
1. Owner-only `/duplicates`, linked from the Library; existing poster and video routes provide previews loaded on demand. Show title/text, source post, size, duration, tags, favourite, and estimated savings.
2. Query eligible equal-size groups in D1. Fetch R2 metadata in bounded batches, comparing non-empty `checksums.md5` plus actual object size. Missing objects/checksums are unverified, never a shared null-hash group.
3. Resume by size and post ID, carrying comparisons across batches. Finish a whole size group before presenting independent keep/delete decisions; a large group must not be silently split by the request cap. Show scan coverage, exclusions, continuation, and failures. D1 size drift can hide matches; R2 validation prevents false positives but cannot recover candidates missed by the prefilter.
4. Exclude multi-video, partial/error, deleted, and unknown-size rows in v1, and count exclusions. Current production evidence has no multi-video entries, but the code supports them.
5. Require explicit keeper and victim selection. Before mutation, the server revalidates live rows, distinct IDs, checksums/sizes, and absence of **every sibling key that post deletion would remove**. Reject ambiguous or stale state. Keep the existing deletion/tombstone/accounting logic in one shared helper rather than copying it.
6. Deleted entries' titles/tags/favourites remain on hidden tombstoned rows; they are not merged into the keeper. Show metadata differences and the permanent deletion effect before confirmation.
7. Delete in bounded steps and report per-item outcomes. D1 and R2 mutations are not atomic; a batch failure can leave partial completion. Fresh validation does not guarantee keeper preservation against concurrent tabs or close the existing cron/delete race documented in `src/index.ts:173`. Stronger guarantees require coordination across all mutation paths and a larger design.

Expected implementation surface: `src/store.ts`, `src/index.ts`, `src/html.ts`, `test/fakes.ts`, focused Store/route tests, and project docs. FakeR2 needs checksum metadata. Tests should cover unequal hashes at equal size, missing hashes/objects, exclusion and sibling checks, keeper disappearance, owner-only access, once-only accounting, partial failures, and scan continuation across group boundaries.

A re-encoded, cropped, or otherwise byte-different copy will not match MD5. Filenames and duration/text are hints, not deletion evidence. Perceptual matching, media identity persistence, automatic download deduplication, shared objects/reference counting, per-attachment deletion, and metadata merging are separate larger changes. No ADR or implementation plan is approved by this investigation.

## Production MD5 verification — 2026-11-06 implementation follow-up

A read-only Wrangler remote-binding probe ran D1 candidate selection and R2 HEAD on all 16 equal-size candidate objects. All 16 exposed explicit 16-byte `checksums.md5`; all actual sizes matched D1. Six pairs matched both MD5 and size; the other two equal-size pairs had different MD5s. Potential redundant video bytes: **772,660,142** (about 773 MB). This supersedes the earlier ETag-only limitation for these objects. No video bodies were downloaded and no production rows/objects were changed. Results are a point-in-time observation, not a promise that later scans return the same groups.
