Updated: 2026-11-07

## Now
- **Delete from thumbnail suggestions (ADR-0029):** every card in the identical- and similar-thumbnail lists on /duplicates has **Delete this video** (confirm → `DELETE /api/videos/:id`, card replaced in place, other results kept). Branch `slick-lamprey`, built on main 2b3ef25. PR and deployment details are in the top JOURNAL entry.
- Production before this change: Worker 6ecc9230-380c-4ff2-9033-d99b46074854 (main 2b3ef25, PR39+PR40 merged), deployed 2026-11-06T16:54:40Z. Its bundle equals the main dry-run (verified 2026-11-07).
- Approximate cards already play inline (`<video controls>`, verified in headless Chromium 2026-11-07). Owner reported no playback; waiting on which device/browser.

## Next
1. Owner, signed in: Duplicates → run either suggestion scan → play a pair → Delete this video on one card. Expect the confirm dialog, then "Deleted from the library" in place, with the rest of the list still there.
2. Owner: say which device/browser shows no playback on similar-thumbnail cards, so it can be reproduced.
3. Keep real-library similarity calibration and physical-device/assistive-tech limitations documented (ADR-0028).
4. Reconcile download-queue and viewer expansion checks separately; no Access policy change.

## Blocked
- Physical-device/assistive-technology acceptance needs owner devices.
- Access expansion still needs authenticated owner validation and test accounts; no admission policy changed.

## Done (last 5; older in JOURNAL)
- 2026-11-07 Added per-card delete to thumbnail suggestion lists (ADR-0029).
- 2026-11-06 PR39 (approximate thumbnails) and PR40 (Reels) merged; main 2b3ef25 deployed as 6ecc9230.
- 2026-11-06 Deployed approximate thumbnails + accepted fullscreen Reels as 318f610d (source 61703e1).
- 2026-11-06 Deployed optional immersive Reels as `ee3627d4`, source `c6d8731`.
- 2026-11-06 Added identical-thumbnail suggestions (`2002eed9`, PR #39).
