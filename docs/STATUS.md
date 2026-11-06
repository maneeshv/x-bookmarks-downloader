Updated: 2026-11-06

## Now
- **Duplicate-review spec proposed; implementation not approved:** [design spec](superpowers/specs/2026-11-06-duplicate-video-review-design.md), based on the [research and committee recommendation](research/2026-11-06-duplicate-video-review.md). Defines D1 size candidates + on-demand R2 MD5, bounded scans, grouped previews, single-video scope, and guarded manual cleanup. Production Workers checksum fields still need verification. No product code or application data changed.
- **Download queue + save-first backfill merged:** PR #38 merge `8e23143` is an ancestor of checkout `1ed0d7d`. Last recorded deployment (2026-10-31): Worker `92b1c6a8-8095-4373-9d8b-e8f9c0ca7df5` at 100%; deployment version was not rechecked on 2026-11-06. [Spec](superpowers/specs/2026-10-31-download-queue-design.md), [plan](superpowers/plans/2026-10-31-download-queue.md), ADR-0023. Rollback recorded: `150f0f24-08b7-44c5-8573-ed30aa2beafc`.
- **Cinematic Library complete:** [plan](superpowers/plans/2026-09-11-cinematic-shelf-library.md), merged PR #33 (`bedc4ff`). The 2026-09-11 verification passed both TypeScript projects and 89 tests; desktop/mobile evidence is in [design-qa.md](../design-qa.md). Runtime checks were not repeated for the 2026-11-06 documentation-only investigation.

## Next
1. Owner reviews the [proposed duplicate-page spec](superpowers/specs/2026-11-06-duplicate-video-review-design.md), tracked in [QUESTIONS](QUESTIONS.md). On approval, record the ADR and write the implementation plan, including read-only real R2 `checksums.md5` verification before cleanup is enabled.
2. Owner, signed in: confirm `/backfill` recorded/queued results and `/queue` behavior; reconcile the download-queue plan's remaining checkboxes and obsolete unrecorded-bookmarks GOTCHAS line. The 2026-11-06 D1 snapshot has no pending/failed rows but does not prove every X bookmark was recorded.
3. Run the authenticated production smoke test: confirm Longest/Shortest, reuse an existing tag, create/save a new tag, and preserve a two-tag filter through Watch → Back. Prior available browsers reached Access login; browser authentication was not rechecked on 2026-11-06.
4. Obtain one viewer's exact verified Cloudflare-account email; then execute the exact-email Access rollout and viewer/non-listed-account tests.
5. Update the main checkout's gitignored `wrangler.toml` with `OWNER_EMAIL` so new Paseo worktrees do not omit it.

## Blocked
- Access expansion is blocked on authenticated owner verification, one friend's exact verified Cloudflare-account email, and a separate non-listed account for the negative test.

## Done (last 5; older in JOURNAL)
- 2026-11-06 Investigated duplicate review with Opus 5.5/Sol and read-only D1/R2 evidence; wrote the proposed design spec without implementing or deleting data.
- 2026-10-31 Deployed save-first backfill + `/queue` as `92b1c6a8` (PR #38).
- 2026-10-31 Diagnosed the `/backfill` timeout (canceled requests leave bookmarks unrecorded); spec approved; built save-first backfill and the `/queue` page with TDD and local browser QA (not deployed).
- 2026-09-11 Deployed Option 1 at 100%, retained live-only playback features, passed 89 tests and source/routing verification.
- 2026-09-10 Generated three imagegen Library previews and documented the complete functionality preservation contract; no code changes.
