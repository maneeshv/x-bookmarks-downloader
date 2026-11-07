Updated: 2026-11-07

## Now
- **Delete from thumbnail suggestions (ADR-0029):** every card in the identical- and similar-thumbnail lists on /duplicates has **Delete this video** (confirm → `DELETE /api/videos/:id`, card replaced in place, other results kept). **Owner accepted 2026-11-07; PR #41 merged into main**, deployed as Worker 0243f624-1957-437a-990e-58d87108d91f at 100%, 2026-11-07T06:29:18Z. Rollback: 6ecc9230 (main 2b3ef25). Live equals merged main; deploy only main or its descendants.
- Previous production: Worker 6ecc9230-380c-4ff2-9033-d99b46074854 (main 2b3ef25, PR39+PR40 merged), deployed 2026-11-06T16:54:40Z. Its bundle equals the main dry-run (verified 2026-11-07).
- Approximate cards already play inline (`<video controls>`, verified in headless Chromium 2026-11-07). Owner reported no playback; waiting on which device/browser.

## Next
1. Owner: say which device/browser shows no playback on similar-thumbnail cards, so it can be reproduced.
2. Keep real-library similarity calibration and physical-device/assistive-tech limitations documented (ADR-0028).
3. Reconcile download-queue and viewer expansion checks separately; no Access policy change.

## Blocked
- Physical-device/assistive-technology acceptance needs owner devices.
- Access expansion still needs authenticated owner validation and test accounts; no admission policy changed.

## Done (last 5; older in JOURNAL)
- 2026-11-07 Per-card delete in thumbnail suggestion lists (ADR-0029), owner-accepted, PR #41 merged, live as 0243f624.
- 2026-11-06 PR39 (approximate thumbnails) and PR40 (Reels) merged; main 2b3ef25 deployed as 6ecc9230.
- 2026-11-06 Deployed approximate thumbnails + accepted fullscreen Reels as 318f610d (source 61703e1).
- 2026-11-06 Deployed optional immersive Reels as `ee3627d4`, source `c6d8731`.
- 2026-11-06 Added identical-thumbnail suggestions (`2002eed9`, PR #39).
