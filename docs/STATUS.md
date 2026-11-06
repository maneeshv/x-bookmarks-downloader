Updated: 2026-11-06

## Now
- **Approximate thumbnails + accepted fullscreen Reels deployed for owner testing:** https://xrender.uk/duplicates and https://xrender.uk/reels. Source61703e1 (approximatea234a98 + accepted Reelsf42b4f6/c6d8731), Worker318f610d-d71d-4ee1-b4d8-951bc232a24d at100%,2026-11-06T13:40:54Z. PR39 updated with combined source; **both PR39 and PR40 remain unmerged pending thumbnail acceptance**.
- **Verified:**195tests, both typechecks, dry-run bundle/session checks, independent review and native combined fullscreen/overlay/navigation/Exit plus thumbnail scanning pass. Live source byte-equals tested/release bundles; SHA256 abb723492fc37ef5e5bce7754c7430bc0d0e29139734cca36edc599880ac0cd4. All bindings/settings, cron, disabled workers.dev/previews preserved. Protected routes302; workers.dev404. Native production browser reached Sign in; owner-authenticated real-library results remain unverified.
- Approximate policy: ADR0028; [QA and test steps](research/2026-11-06-approximate-thumbnail-qa.md). Review-only, no thumbnail deletion, no production media mutation or migration. Rollback: ee3627d4-16f6-4f24-bd0a-59a0dfc08156 (accepted fullscreen without approximate).

## Next
1. Owner, signed in: Duplicates → Suggested matches — similar thumbnails → Scan similar thumbnails. Review each pair and Watch video links; try Cancel scan. Scores are hash similarity, not duplicate certainty. Existing Scan thumbnails remains exact poster equality; Scan for duplicates remains exact-video review.
2. Obtain owner thumbnail acceptance before merging either PR. Preserve combined61703e1 or descendants for any subsequent deployment; deploying older PR40/PR39 source would regress accepted functionality.
3. Keep physical-device/assistive-tech and real-library calibration limitations documented; synthetic calibration does not establish production precision/recall.
4. Reconcile download-queue and viewer expansion checks separately; no Access policy change in this release.

## Blocked
- Physical-device/assistive-technology acceptance needs owner devices. The owner authorized deployment for this hands-on testing.
- Access expansion still needs authenticated owner validation and test accounts; no admission policy changed.

## Done (last 5; older in JOURNAL)
- 2026-11-06 Deployed optional immersive Reels as `ee3627d4`, source `c6d8731`; approximate matching excluded.
- 2026-11-06 Deployed combined original Reels + identical-thumbnail review as `e9dcde25`, source `95e2571`.
- 2026-11-06 Added/deployed identical-thumbnail suggestions (`2002eed9`, PR #39) before combined Reels deployment.
- 2026-11-06 Built/published original Reels PR #40 with approved spec and visual previews.
- 2026-10-31 Deployed save-first backfill + Queue (`92b1c6a8`, PR #38).
