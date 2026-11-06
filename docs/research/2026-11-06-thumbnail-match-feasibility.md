# Thumbnail-match feasibility
Date: 2026-11-06 | Assessment only; not an approved design

## Recommendation
Feasible as a separate **Suggested matches — thumbnails only** section. Start with identical stored poster files, then add browser-side perceptual comparison only if exact poster matching misses useful examples. Neither signal confirms identical videos. Keep existing video-checksum grouping and deletion guards unchanged; suggestions have playback/Watch links, no keeper/removal controls or automatic selection. Any direct deletion from visual suggestions needs a separate approved design.

## Current evidence
- `src/x.ts:40` selects the first video's X preview URL. `src/sync.ts:96` copies allowlisted JPEG/PNG/WebP bodies (at most 5 MiB) into private R2. `src/store.ts:284` stores `posters/<postId>` using conditional write-once PUT. URLs identify source locations, not image equality; comparing stored bytes avoids URL variations.
- `src/index.ts:89` serves same-origin, authenticated posters with ETag and private immutable caching. Missing posters return a shared SVG placeholder with HTTP 200. Skip missing HEAD results, unsupported types and decode failures; never fingerprint that placeholder.
- `src/store.ts:57` prefilters current video candidates by equal video size. Thumbnail suggestions need a separate paginated query over live single-video entries, without equal-video-size or equal-duration filtering. Multi-video posts have only one post poster and remain excluded in the smallest version.
- `src/duplicates.ts:44` requires fresh equal video MD5/size and absent sibling objects before cleanup. Do not weaken it or pass thumbnail fingerprints into it.
- The earlier 2026-11-06 read-only snapshot had 397 live single-video entries. This assessment did not refresh production counts or read image bodies. No poster checksum coverage, thumbnail byte distribution or visual threshold has been measured.

## Three distinct signals
1. **Exact poster file match:** paginated R2 HEAD; group present explicit poster MD5 plus poster size, not video size or ETag. No image decoding/body fetch or migration. Missing checksums remain unknown. This uses the same practical checksum evidence as existing file comparison, but proves nothing about video contents. Poster MD5 availability still needs a small bounded check; existing live evidence covered videos only.
2. **Exact decoded pixels:** compare oriented, color-normalized full-resolution pixels and dimensions. Can ignore file metadata/container differences; lossy recompression commonly changes pixels. Resized-image equality is only normalized-image equality, not exact original pixels. Decoding/normalization adds work and is not a compelling intermediate release.
3. **Perceptual hash:** recommend simple 64-bit dHash before more elaborate DCT-based pHash. Version the whole pipeline: orientation, sRGB/alpha background, full-frame/no-crop aspect policy, explicit integer grayscale/resampling, 9×8 sampling, gradient direction/tie rule and bit ordering. Compare via Hamming distance. Any percentage is `100 × (1 − differingBits/64)`: hash similarity, not probability of duplicate video or percentage of equal pixels. No threshold is validated; calibrate conservative settings with bounded labeled examples including recompressions, crops, resized images, blank/shared title cards and unrelated videos. Suppress or flag low-detail images.

## Placement and limits
Exact poster-file matching belongs in the existing Worker as bounded HEAD batches (reuse the scan concurrency pattern). For perceptual suggestions, the smallest dependency-free option is on-demand browser decoding of same-origin `/p/:id`, with Canvas pixel access, bounded concurrency, decoded-dimension and transfer budgets, pause/progress and counts of skipped entries. At 397 entries there are 78,606 possible pairs; hash comparison is small, but downloading/decoding posters can dominate. The 5 MiB per-file cap does not make an unrestricted library scan cheap.

The deployed app has no image decoder dependency or Images binding; its generated Worker types do not expose Canvas/createImageBitmap. Do not assume browser Web Worker APIs exist in Cloudflare Workers. Server-side perceptual processing would need an explicit codec/Wasm path or image service integration with measured resource limits. Cloudflare Images supports private R2 byte inputs, but adds configuration/processing and is unnecessary for the first option. No embeddings, AI, or external private-media upload needed.

Browser hashing is deterministic for fixed decoded pixels and a versioned algorithm, but browser codec/color/resampling differences can affect bits. Use explicit JS normalization and keep first-version hashes in page memory; do not promise cross-browser bit-identical results. Strict cross-device reproducibility would require a pinned decoder pipeline, a larger change. Future persistent hashes must key by poster object identity (ETag as a cache version, not equality proof), algorithm/decoder version; invalidate on replacement, deletion and version change. Fresh paginated metadata must exclude tombstones/missing objects. If poster replacement is introduced, version the fetch URL too because existing `/p/:id` responses are immutable-cached.

## Presentation and change scope
Show pairs (or matches relative to a clearly labeled anchor), reason, thumbnail, title, duration, video size, metadata differences and lazy playback. Different durations remain eligible. Similarity is not transitive: A≈B and B≈C must not imply A≈C. Even identical thumbnails can be shared intros, covers or blank frames; cropping/aspect changes can hide actual relationships. No guaranteed recoverable-byte total for suggestions.

Likely exact-only change: Store query, owner-only paginated poster metadata endpoint/helper, separate HTML/browser suggestion rendering, focused tests. Perceptual follow-up adds a pure versioned hash helper and bounded browser loader. Test different video lengths/sizes, missing placeholder, checksum absence, unsupported/corrupt/oversize images, pagination, cache invalidation, pairwise non-transitivity, low-detail examples, and that suggestions cannot invoke exact cleanup. No migration needed initially. Runtime/performance and calibrated thresholds remain unresolved until a bounded validation spike is authorized.

## Primary documentation consulted
- [Browser createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap): orientation/alpha/resize options; default color conversion is implementation-specific.
- [Canvas getImageData](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData): pixel access, color space and same-origin restrictions.
- [Cloudflare Images binding](https://developers.cloudflare.com/workers/llms-full.txt): private byte input rather than a public image URL (Context7 Workers documentation).
- [Workers Wasm](https://developers.cloudflare.com/workers/runtime-apis/webassembly/) and [limits](https://developers.cloudflare.com/workers/platform/limits/): explicit codec alternatives must fit isolate resources (128 MB memory documented).

No implementation, commit, deployment, production scan or data mutation in this assessment.
