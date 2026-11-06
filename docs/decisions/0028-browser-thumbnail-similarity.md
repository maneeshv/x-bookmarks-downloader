# 0028. Suggest visually similar thumbnails with bounded browser comparison
Date: 2026-11-06 | Status: DECIDED

## Context
Identical-poster checks miss resized or recompressed images. The owner approved approximate review in PR39, with no deployment or merge. Shared covers cannot establish duplicate videos. Extend ADR0025 without changing exact-video deletion semantics.

## Decision
Use dependency-free `dhash-rgb-v1` in the owner's browser, on explicit action. Reuse authenticated paginated poster metadata and same-origin `/p/:id`. No video body reads, external service, persistent fingerprints, migration or new dependency. Cache fingerprints/previews only within a scan, keyed by explicit poster MD5 and byte size; restarting clears them.

Decode JPEG/PNG/static WebP with native browser codecs after encoded dimension checks. EXIF-oriented native-size sRGB Canvas pixels are normalized using full-frame 9×8 integer block means, alpha over black, grayscale `(77R+150G+29B+128)>>8`, then 64 horizontal comparisons (left > right; ties zero). Candidate pairs require Hamming distance <=3, RGB block mean absolute difference <=18/255 and aspect-ratio difference <=3%. Reject low grayscale variance (<18²), fewer than12 strong edges (delta>=8), or near-uniform hashes (<8 or>56 set bits). Version any normalization/policy change.

Bound a scan to500 entries,32MiB poster budget,1MiB/poster,4million decoded pixels,4096px/side and100pairs. Fetch/decode sequentially, yield between entries,15second network timeout; Cancel aborts fetch and discards pending native decode output. A delivered chunk can exceed its declared size before cancellation; count it honestly, retain no oversized body, and issue no further body request once over budget. Metadata calls remain bounded by existing100-row pages. At most124,750 pair comparisons. Previews are <=192px/side data URLs (<=32,768 characters) from the same decoded pixels, avoiding extra uncounted poster requests.

Only independent pairs with previews, video size/duration and Watch links are actionable for manual review. Label the score hash similarity, never probability or storage savings. Exclude exact poster pairs and exact-video pairs known to the current page; remove suggestions if a subsequent exact scan classifies them. No thumbnail keeper/deletion controls. Existing exact cleanup invalidates suggestions.

## Evidence and limitations
[Calibration and QA](../research/2026-11-06-approximate-thumbnail-qa.md) records synthetic Chromium155 results. Threshold3 lies between tested positive distance0 and nearest negative7; this small corpus does not establish real-library accuracy or cross-browser equivalence. Native decode/color handling may differ; deterministic normalization applies to fixed decoded pixels. Shared covers can falsely match; crops, aspect changes, overlays and low-detail images can be missed. Unknown checksums, missing posters, unsupported formats and failures are skipped with partial coverage. The500-entry cap requires a fresh scan, not continuation beyond the cap.

Revisit with representative owner-reviewed samples before adjusting thresholds, adding worker decoding/persistent indexes, or supporting broader coverage. Thumbnail-based deletion requires a separate design and authorization. Approximate implementation stays undeployed until explicitly approved.

Sources: [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap), [Canvas getImageData](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData) (Context7 consulted2026-11-06).
