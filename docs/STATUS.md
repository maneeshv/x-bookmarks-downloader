Updated: 2026-11-06

## Now
- **Reels implemented and verified locally:** [approved spec + previews](superpowers/specs/2026-11-06-reels-view-design.md), [plan](superpowers/plans/2026-11-06-reels-view.md), [QA evidence](research/2026-11-06-reels-implementation-qa.md). Both typechecks, 136 tests, dry-run bundle check and 25 browser checks pass. Independent review approved the fixes for PR. Published as [PR #40](https://github.com/maneeshv/x-bookmarks-downloader/pull/40) from `feat/reels-view`; no deployment.
- **Download queue + save-first backfill:** deployment last recorded on 2026-10-31 as Worker `92b1c6a8-8095-4373-9d8b-e8f9c0ca7df5` at 100% from `94be540`; PR #38 is merged in this checkout's ancestry (`8e23143`, HEAD `1ed0d7d`). Production was not rechecked on 2026-11-06. [Spec](superpowers/specs/2026-10-31-download-queue-design.md), [plan](superpowers/plans/2026-10-31-download-queue.md), ADR-0023. Recorded rollback: `150f0f24-08b7-44c5-8573-ed30aa2beafc`.
- **Option 1 is deployed and merged to `main` (PR #33, merge `bedc4ff`):** the [Cinematic shelf plan](superpowers/plans/2026-09-11-cinematic-shelf-library.md) is complete. Existing search, tags, sorts, pagination, Watch editing, Stats, and access controls are preserved. Both TypeScript projects and all 89 tests pass; desktop/mobile comparison and interaction evidence is in [design-qa.md](../design-qa.md).

## Next
1. Review [Reels PR #40](https://github.com/maneeshv/x-bookmarks-downloader/pull/40) and complete physical iOS Safari/Android Chrome release checks in the [QA record](research/2026-11-06-reels-implementation-qa.md). Do not deploy without separate authorization.
2. Owner, signed in: open `https://xrender.uk/backfill` once (check `recorded`/`queued`), then `/queue`. Then delete the GOTCHAS unrecorded-bookmarks line and tick the plan's last two boxes.
3. Sign into Cloudflare Access for an authenticated production smoke test (the browser in the recorded attempt reached the login screen): confirm Longest/Shortest, reuse an existing tag, create/save a new tag, and preserve a two-tag filter through Watch → Back.
4. Obtain one viewer's exact verified Cloudflare-account email; then execute the exact-email Access rollout and viewer/non-listed-account tests.
5. Update the main checkout's gitignored `wrangler.toml` with `OWNER_EMAIL` so new Paseo worktrees do not omit it.

## Blocked
- Access expansion is blocked on authenticated owner verification, one friend's exact verified Cloudflare-account email, and a separate non-listed account for the negative test.

## Done (last 5; older in JOURNAL)
- 2026-11-06 Completed Reels committee investigation, reviewed the detailed proposed spec, and generated/inspected the UI mockup and experience infographic. Design artifacts only.
- 2026-10-31 Deployed save-first backfill + `/queue` as `92b1c6a8` (PR #38).
- 2026-10-31 Diagnosed the `/backfill` timeout (canceled requests leave bookmarks unrecorded); spec approved; built save-first backfill and the `/queue` page with TDD and local browser QA (not deployed).
- 2026-09-11 Deployed Option 1 at 100%, retained live-only playback features, passed 89 tests and source/routing verification.
- 2026-09-10 Generated three imagegen Library previews and documented the complete functionality preservation contract; no code changes.
