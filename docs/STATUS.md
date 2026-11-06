Updated: 2026-11-06

## Now
- **Immersive Reels deployed for owner testing:** optional Full screen, viewport fallback, tap-toggle overlays, persistent Exit and accessible seeking. [QA/screenshots and deployment evidence](research/2026-11-06-reels-immersive-qa.md), ADR0027. Owner explicitly authorized “Deploy the reels change” on 2026-11-06, superseding the Reels-only deployment hold.
- **Verified production:** Worker `ee3627d4-16f6-4f24-bd0a-59a0dfc08156`, source `c6d8731` (implementation `a258d6b`), 100% at 2026-11-06T13:09:07Z. Fetched live source byte-equals the tested and release bundles; bindings, cron and subdomain settings preserved. Library/Reels/Duplicates/thumbnail API require Access (302); workers.dev disabled (404). Rollback: `e9dcde25-bf50-4933-92de-f8cb6807a7bd`.
- **Exact duplicate/identical-thumbnail functionality preserved. Approximate matching excluded:** thumbnail owner confirmed no intervening production/config changes. Approximate work remains separate in PR #39, with no deployment or merge authorized. [PR #40](https://github.com/maneeshv/x-bookmarks-downloader/pull/40) remains open/unmerged. CI is test-only; no auto-deploy.
- Reused unchanged-source verification: 181 tests, both typechecks, 23 immersive +25 original browser checks and independent review. Fresh dry-run bundle/emitted-factory checks and release/source/config verification pass. Signed-in production playback and physical devices remain unverified.

## Next
1. Test deployed immersive Reels at https://xrender.uk/reels and review PR #40. Keep PR #39 approximate work undeployed; obtain explicit authorization before any merge or approximate deployment, and reconcile branches before a later release.
2. Complete physical iOS Safari/Android Chrome acceptance: browser chrome/safe areas, tap/swipe/scrub, sound, rotation/fullscreen exit, screen-reader focus and long/high-bitrate media. Desktop emulation cannot certify these.
3. Owner-signed-in production checks from the prior release remain pending (the available browser reached Cloudflare Sign in): Library, Reels, Watch return, duplicate/thumbnail scans; no real deletion needed.
4. Reconcile the download-queue plan's owner `/backfill`/`queue` checks; a zero-pending D1 snapshot does not prove every bookmark was recorded.
5. For viewer expansion, obtain one friend's exact verified email and perform owner/viewer/non-listed-account acceptance before changing Access policies.

## Blocked
- Physical-device/assistive-technology acceptance needs owner devices. The owner authorized deployment for this hands-on testing.
- Access expansion still needs authenticated owner validation and test accounts; no admission policy changed.

## Done (last 5; older in JOURNAL)
- 2026-11-06 Deployed optional immersive Reels as `ee3627d4`, source `c6d8731`; approximate matching excluded.
- 2026-11-06 Deployed combined original Reels + identical-thumbnail review as `e9dcde25`, source `95e2571`.
- 2026-11-06 Added/deployed identical-thumbnail suggestions (`2002eed9`, PR #39) before combined Reels deployment.
- 2026-11-06 Built/published original Reels PR #40 with approved spec and visual previews.
- 2026-10-31 Deployed save-first backfill + Queue (`92b1c6a8`, PR #38).
