Updated: 2026-11-06

## Now
- **Reels detailed spec ready for review:** [proposed design](superpowers/specs/2026-11-06-reels-view-design.md), based on the [committee investigation](research/2026-11-06-reels-feasibility.md). It defines scope, URL/session state, playback, Details return, capacity/error behavior and acceptance criteria. No implementation approved; proposed sizing bounds and phone interaction require validation.
- **Download queue + save-first backfill:** deployment last recorded on 2026-10-31 as Worker `92b1c6a8-8095-4373-9d8b-e8f9c0ca7df5` at 100% from `94be540`; PR #38 is merged in this checkout's ancestry (`8e23143`, HEAD `1ed0d7d`). Production was not rechecked on 2026-11-06. [Spec](superpowers/specs/2026-10-31-download-queue-design.md), [plan](superpowers/plans/2026-10-31-download-queue.md), ADR-0023. Recorded rollback: `150f0f24-08b7-44c5-8573-ed30aa2beafc`.
- **Option 1 is deployed and merged to `main` (PR #33, merge `bedc4ff`):** the [Cinematic shelf plan](superpowers/plans/2026-09-11-cinematic-shelf-library.md) is complete. Existing search, tags, sorts, pagination, Watch editing, Stats, and access controls are preserved. Both TypeScript projects and all 89 tests pass; desktop/mobile comparison and interaction evidence is in [design-qa.md](../design-qa.md).

## Next
1. Review the [Reels spec](superpowers/specs/2026-11-06-reels-view-design.md) and [open scope choices](QUESTIONS.md). After design approval, validate playlist sizing and the device interaction, then prepare an implementation plan; revise the design if either gate fails.
2. Owner, signed in: open `https://xrender.uk/backfill` once (check `recorded`/`queued`), then `/queue`. Then delete the GOTCHAS unrecorded-bookmarks line and tick the plan's last two boxes.
3. Sign into Cloudflare Access for an authenticated production smoke test (the browser in the recorded attempt reached the login screen): confirm Longest/Shortest, reuse an existing tag, create/save a new tag, and preserve a two-tag filter through Watch → Back.
4. Obtain one viewer's exact verified Cloudflare-account email; then execute the exact-email Access rollout and viewer/non-listed-account tests.
5. Update the main checkout's gitignored `wrangler.toml` with `OWNER_EMAIL` so new Paseo worktrees do not omit it.

## Blocked
- Access expansion is blocked on authenticated owner verification, one friend's exact verified Cloudflare-account email, and a separate non-listed account for the negative test.

## Done (last 5; older in JOURNAL)
- 2026-11-06 Completed Reels committee investigation, then wrote and reviewed the detailed proposed spec. Documentation only.
- 2026-10-31 Deployed save-first backfill + `/queue` as `92b1c6a8` (PR #38).
- 2026-10-31 Diagnosed the `/backfill` timeout (canceled requests leave bookmarks unrecorded); spec approved; built save-first backfill and the `/queue` page with TDD and local browser QA (not deployed).
- 2026-09-11 Deployed Option 1 at 100%, retained live-only playback features, passed 89 tests and source/routing verification.
- 2026-09-10 Generated three imagegen Library previews and documented the complete functionality preservation contract; no code changes.
