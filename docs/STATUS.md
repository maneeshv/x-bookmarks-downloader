Updated: 2026-11-06

## Now
- **Approximate thumbnail review implemented and verified, not deployed:** [plan](superpowers/plans/2026-11-06-approximate-thumbnails.md). PR39 only;185tests, typechecks, dry-run bundle, independent review and native desktop/mobile QA pass. [Calibration/QA](research/2026-11-06-approximate-thumbnail-qa.md), ADR0028. **NO DEPLOY / NO MERGE** for approximate until separate owner approval. Reels owner reports its separately authorized fullscreen release ee3627d4/sourcec6d8731 at100% (2026-11-06T13:09:07Z), excluding approximate; this task made no production calls.
- **Prior independently recorded combined deployment (superseded by Reels owner report above):** `https://xrender.uk/reels`, Worker `e9dcde25-bf50-4933-92de-f8cb6807a7bd` at 100%, source commit `95e2571`, deployed 2026-11-06T11:58:56Z. Reels PR #40 includes already-live PR #39 (`763ac15`, thumbnail implementation `3699ff1`); both PRs remain open. Fetched live source exactly equals the release bundle; Scan thumbnails and its owner-only API remain present. All vars/resource bindings, domain, 30-minute cron and disabled workers.dev/previews are preserved. No migration or production data deletion. Rollback: `2002eed9-d2db-4ac7-98d5-530f44514131` (thumbnail release).
- **Verification:** combined branch passes 171 tests, both typechecks, bundle check, 25 built-Worker Chrome checks, independent integration review and CI. Signed-out Library/Reels/Duplicates/thumbnail API return Access 302; workers.dev returns404. Native Arc opened Reels and reached Cloudflare Sign in. Signed-in production behavior and physical iOS/Android acceptance remain pending. [Reels spec + previews](superpowers/specs/2026-11-06-reels-view-design.md), [Reels QA](research/2026-11-06-reels-implementation-qa.md), [thumbnail QA](research/2026-11-06-thumbnail-suggestions-qa.md).

- **Download queue + save-first backfill merged:** PR #38 merge `8e23143` is an ancestor of checkout `1ed0d7d`. Last recorded deployment (2026-10-31): Worker `92b1c6a8-8095-4373-9d8b-e8f9c0ca7df5` at 100%; version/source/settings rechecked on 2026-11-06. [Spec](superpowers/specs/2026-10-31-download-queue-design.md), [plan](superpowers/plans/2026-10-31-download-queue.md), ADR-0023. Rollback recorded: `150f0f24-08b7-44c5-8573-ed30aa2beafc`.
- **Cinematic Library complete:** [plan](superpowers/plans/2026-09-11-cinematic-shelf-library.md), merged PR #33 (`bedc4ff`). The 2026-09-11 verification passed both TypeScript projects and 89 tests; desktop/mobile evidence is in [design-qa.md](../design-qa.md). Runtime checks were not repeated for the 2026-11-06 documentation-only investigation.


## Next
0. Owner, signed in: test `/reels` on iOS Safari/Android Chrome: unmute, swipe both ways, scrub/pause/fullscreen, Shuffle, Details → Back to Reels; then verify desktop buttons/keyboard and long media on constrained networks. Review PR #40 and #39 without separately deploying an older branch.
1. Owner, signed in: test Library → Duplicates → Scan thumbnails for review-only suggestions; use Scan for duplicates for confirmed-video groups and explicit keep/remove choices. Review PR #39; approximate deployment/merge requires fresh authorization.
2. Owner, signed in: confirm `/backfill` recorded/queued results and `/queue` behavior; reconcile the download-queue plan's remaining checkboxes and obsolete unrecorded-bookmarks GOTCHAS line. The 2026-11-06 D1 snapshot has no pending/failed rows but does not prove every X bookmark was recorded.
3. Run the authenticated production smoke test: confirm Longest/Shortest, reuse an existing tag, create/save a new tag, and preserve a two-tag filter through Watch → Back. Prior available browsers reached Access login; browser authentication was not rechecked on 2026-11-06.
4. Obtain one viewer's exact verified Cloudflare-account email; then execute the exact-email Access rollout and viewer/non-listed-account tests.
5. Update the main checkout's gitignored `wrangler.toml` with `OWNER_EMAIL` so new Paseo worktrees do not omit it.

## Blocked
- Access expansion is blocked on authenticated owner verification, one friend's exact verified Cloudflare-account email, and a separate non-listed account for the negative test.

## Done (last 7; older in JOURNAL)
- 2026-11-06 Added review-only identical-thumbnail suggestions to PR #39 and deployed `2002eed9`; 132 tests and CI pass.
- 2026-11-06 Implemented, verified, pushed PR #39 and deployed duplicate review (`4b83031c`); no production video deletion.
- 2026-11-06 Investigated duplicate review with Opus 5.5/Sol and read-only D1/R2 evidence; wrote the proposed design spec without implementing or deleting data.
- 2026-10-31 Deployed save-first backfill + `/queue` as `92b1c6a8` (PR #38).
- 2026-10-31 Diagnosed the `/backfill` timeout (canceled requests leave bookmarks unrecorded); spec approved; built save-first backfill and the `/queue` page with TDD and local browser QA (not deployed).
- 2026-09-11 Deployed Option 1 at 100%, retained live-only playback features, passed 89 tests and source/routing verification.
- 2026-09-10 Generated three imagegen Library previews and documented the complete functionality preservation contract; no code changes.
