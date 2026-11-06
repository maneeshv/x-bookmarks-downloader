# Approximate thumbnail suggestions implementation plan

Date: 2026-11-06. Approved via Sage: build deterministic approximate thumbnails in Duplicates, commit/push/update PR39; **do not deploy or merge**. Reels fullscreen belongs to PR40; ADR0027 reserved there.

**Goal:** Find visually similar stored posters, including videos with different names, sizes and durations, as review-only pairs.
**Architecture:** Reuse owner-only paginated poster metadata. On explicit action, read same-origin posters in the browser, validate encoded dimensions before decoding, normalize decoded pixels in pure JS, compare versioned dHash plus conservative appearance checks. No server decoder, database change or dependency. Keep all work/page caches ephemeral.
**Spec:** approved coordinator scope in this session and [feasibility](../../research/2026-11-06-thumbnail-match-feasibility.md), perceptual follow-up.

## Contract
- Preserve exact video scanner/deletion validation and identical-poster review.
- A separate manual scan with warning of thumbnail transfer, progress, Cancel, and restart. At most 500 entries, 32 MiB requested poster budget (unexpected delivered chunks counted before cancellation), 1 MiB per poster, 4 million decoded pixels / 4096 per side, one image fetch/decode at a time, 100 displayed pairs. Stop with explicit partial coverage on any cap; abort active fetch on Cancel. Missing/unsupported/failed/low-detail images counted and never grouped. Metadata batches reuse 100-row cursor; no video reads.
- `dhash-rgb-v1`: EXIF-oriented browser decode, sRGB Canvas at native dimensions, alpha composited onto black, integer full-frame 9x8 block means, grayscale `(77R+150G+29B+128)>>8`, 64 row-major horizontal comparisons (left > right; ties zero). No crop alignment. Fixed pure-pixel output; browser decode/color differences remain documented.
- Initial conservative candidate rule to validate: <=3 differing bits, mean per-block RGB absolute difference <=18/255, aspect ratio difference <=3%; suppress flat/low-detail or near-uniform hashes. Calibrate using synthetic image fixtures and real browser resize/JPEG/WebP encodings; revise constants only with recorded evidence. Never claim reliability for arbitrary user media.
- Pairwise rendering, hash similarity `100*(1-distance/64)` labelled as such, no probability/storage claim. Preview/Watch links, visible video duration/size and reason. Exclude same explicit poster MD5+size and known exact-video pairs. Similarity is not transitive; no union/group merging. No keep/delete controls or calls to resolve.
- No secret/image upload, embedding, persistent index or new production scan. Inspect all CI workflows for auto-deploy before push. Baseline includes existing deployed Reels95e2571; no edits to Reels source.

## Tasks (inline execution with independent review)
- [x] Pure hash/calibration TDD: add `src/perceptual.ts`, `test/perceptual.test.ts`, deterministic fixtures. Assert normalization stability, resize positives, unrelated/color/crop/low-detail negatives, pairwise nontransitivity and exact-poster suppression. Validate image headers/bounds.
- [x] Browser runner TDD: add `src/perceptual-scan.ts`, tests for budgets, one active read, cancellation, cross-page pairs, missing/invalid metadata, stale body size, safe MIME and bounded streaming. Inject decoder and fetch for focused runner checks; default decoder uses same-origin Canvas only.
- [x] UI TDD: extend duplicate renderer and script with separate section, progress/cancel, read-only cards, mutual exclusion with existing scans/cleanup, invalidation after cleanup, exact-pair suppression. Execute serialized/bundled script regressions.
- [x] Browser calibration and interaction: local synthetic page using real browser codec, desktop/mobile scan, cancellation, exclusions and zero cleanup requests. Record measured fixture distances/threshold outcomes and browser limits. Run full checks + independent review; fix findings.
- [x] Update ADR0028/architecture/JOURNAL/STATUS/QA, inspect CI, commit/push PR39, update PR scope. No deployment/merge. Report commit, tests, calibration and limits.

Verification: `node --no-warnings --test test/perceptual*.test.ts test/duplicates*.test.ts`, `npm run check`, `git diff --check`, `scripts/check-session.sh`. Product writes follow failing tests. Browser caps and threshold are fixed versioned policy, not user-supplied values.
