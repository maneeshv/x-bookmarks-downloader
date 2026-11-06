Updated: 2026-11-06

## Now
- **Approximate-thumbnail deployment authorized, verified, ready to publish:** owner accepted fullscreen Reels and requested thumbnail testing. Combining approximate a234a98 with accepted Reels f42b4f6/c6d8731. Combined195tests/typechecks/bundle, independent review and native Reels/thumbnail smoke pass. Neither PR39 nor PR40 may merge until thumbnail acceptance. Reels owner confirmed release hold/sole deployment ownership.
- **Independently verified current production:** Worker ee3627d4-16f6-4f24-bd0a-59a0dfc08156 at100%, sourcec6d8731,2026-11-06T13:09:07Z. Live SHA256 eb4440fe6285c1328d7d66ed5afa083291dad9ca5bb37edbe1d3f14085a765bd. This includes accepted fullscreen and exact/identical-thumbnail review; approximate remains pending deployment. All local plain-text vars match; settings/cron/subdomains captured for comparison.
- Approximate design/limits: ADR0028, [plan](superpowers/plans/2026-11-06-approximate-thumbnails.md), [QA](research/2026-11-06-approximate-thumbnail-qa.md). Fixed-image synthetic calibration only; suggestions cannot delete. No production video deletion or migration.

## Next
1. Complete combined checks, deploy authorized source and verify revision/source/settings and both features. Then owner: Duplicates → Scan similar thumbnails, review pairs and Watch links. No merge until user acceptance.
2. Keep physical iOS/Android and assistive-tech limitations documented; owner accepted Reels functionality, not a comprehensive device certification.
3. Reconcile download-queue owner checks and viewer expansion separately; no Access policy changes in this release.

## Blocked
- Physical-device/assistive-technology acceptance needs owner devices. The owner authorized deployment for this hands-on testing.
- Access expansion still needs authenticated owner validation and test accounts; no admission policy changed.

## Done (last 5; older in JOURNAL)
- 2026-11-06 Deployed optional immersive Reels as `ee3627d4`, source `c6d8731`; approximate matching excluded.
- 2026-11-06 Deployed combined original Reels + identical-thumbnail review as `e9dcde25`, source `95e2571`.
- 2026-11-06 Added/deployed identical-thumbnail suggestions (`2002eed9`, PR #39) before combined Reels deployment.
- 2026-11-06 Built/published original Reels PR #40 with approved spec and visual previews.
- 2026-10-31 Deployed save-first backfill + Queue (`92b1c6a8`, PR #38).
