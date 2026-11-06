# Approximate thumbnail calibration and QA
Date: 2026-11-06. Synthetic local media only. **Not deployed or merged.**

## Calibration
Real native Arc/Chromium155 decoding, using the production decoder and hash policy. Relative to `original.png`:

| Fixture | Hamming distance /64 | RGB block MAE /255 | Result |
|---|---:|---:|---|
| original JPEG |0|0.704|match|
| recompressed JPEG (q12) |0|0.690|match|
| resized JPEG (90×80) |0|0.741|match|
| browser WebP (quality0.55) |0|0.588|match|
| unrelated pattern |7|13.852|reject|
| near-miss pattern |23|37.056|reject|
| centered crop (126×112) |12|30.583|reject|
| blank and smooth gradient |—|—|low-detail exclusion|

Initial distance<=3 is conservative against these examples; tests cover3bit acceptance/4bit rejection, color/aspect/version gates and nontransitive relationships. All measured positive distances are0: these fixtures do not prove3 is generally optimal. No production corpus, accuracy estimate or cross-browser reproducibility claim. Fixture generator is `scripts/generate-thumbnail-fixtures.mjs`; PNG/JPEG assets are committed, so CI needs no FFmpeg. The installed FFmpeg lacks WebP encoding; calibration generates WebP with Canvas instead.

## Interaction evidence
Used `scripts/thumbnail-preview.mjs` with FakeD1/KV/R2, synthetic owner authentication and a local MP4. No production configuration or data read.
- Native desktop: clicked scan;11/11checked,8usable,3skipped,9pairs. Inspected paired cards with different sizes/durations and Watch links; no selection or deletion controls.
- Native390px iframe: clicked scan, scrolled stacked cards with contained previews and wrapping text, clicked Play (native control changed to Pause), then Watch (navigated to `/watch/91000`). Physical mobile Safari/Android were not tested.
- Before explicit Play, local request log showed one metadata GET and nine unique poster GETs,285,905poster bytes; no repeated preview GET, video GET, or POST. Preview data URLs reuse decoded pixels.
- Slow fixture: clicked Cancel mid-scan; displayed Cancelled/partial coverage (8/11checked,6pairs), re-enabled controls. Focused tests prove active abort, no later pair publication and discard after cancel during decode.
- Automated emitted-page test covers mutual exclusion, read-only pairs, no automatic requests, later exact-video classification pruning. Scanner tests cover cross-page matching, repeated poster caching, missing/placeholder/decode failures, metadata503, oversized streams, all caps, maximum valid post IDs and no extra metadata page at the entrycap.
- Independent reviewer found an initial preview-fetch budget bypass; replaced remote preview URLs with bounded decoded data URLs. Final review reported no remaining actionable findings.

## Verification and limits
`npm run check`: both TypeScript projects,185tests, Wrangler dry-run bundle and session gate. Exact deletion/auth regressions included; no exact server cleanup code changes. CI workflow contains tests/typechecks/dry-run only, no deploy.

Policy details: ADR0028. Native decode cannot be interrupted mid-call; cancellation discards its result.32MiB is the requested poster budget, not a guarantee against already-delivered unexpected network chunks. Such bytes are counted and processing stops. Metadata JSON and network framing are outside that poster counter. Scan progress reports skipped/partial coverage. Single-video entries only; library changes during scanning are not a transaction. Review-only hash similarity is not the chance that videos duplicate each other. Shared detailed covers can still match unrelated videos. No estimated reclaimable bytes for suggestions.

## Authorized combined deployment follow-up
2026-11-06: owner accepted fullscreen Reels and authorized approximate deployment for testing, without merging either PR. Integrated f42b4f6 Reels into a234a98 approximate; no product conflicts or changes to either feature. Combined195tests, typechecks, dry-run bundle and independent review pass. Native combined build verified fullscreen playback, tap overlay hide/show, navigation/Exit and thumbnail scan11/11checked,8usable,3skipped,9pairs. Live preflight independently matched ee3627d4/sourcec6d8731 and its recorded source hash; config/resource bindings/cron/subdomain flags matched. Deployment revision and postflight will be recorded below.
