# Reels view implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute the checked tasks in this worktree; do not deploy.

**Goal:** Add the approved Reels view, preserve Library/Watch, verify it locally, commit, push and open a PR.

**Architecture:** One authenticated server-rendered `/reels` document embeds a complete bounded playlist. A small client controller uses one native video and three snap slots, with versioned tab-session state and safe return links. Existing Worker/D1/R2 remain the media path.

**Tech Stack:** TypeScript, Cloudflare Workers, native browser APIs, existing node:test. No new runtime dependency.

**Spec:** [Approved design](../specs/2026-11-06-reels-view-design.md).

## Global constraints

- Existing Library/Watch behavior and viewer/owner separation are preserved. No Reels metadata/progress POSTs.
- Absolute imports. At most 1,000 items and 512 KiB escaped UTF-8 playlist JSON; no truncated feed.
- One playable file per downloaded nondeleted post; full selected Library filter/order; no public media paths.
- Default muted autoplay attempt, loop current clip/manual next, native controls, separate session progress.
- Actual iOS/Android testing is a release gate. Local browser checks cannot be reported as phone testing.
- Owner approved build/test/commit/push/PR on 2026-11-06 and explicitly prohibited deployment.

## Task 1: Approval, bounds and shared state

**Files:** spec, ADR-0024, STATUS/QUESTIONS; `src/reels-state.ts`, `test/reels-state.test.ts`.

- [x] Embed both approved previews and record approved defaults and remaining physical-device release gate.
- [x] Measure eligible production count/projected bytes read-only where available and synthetic 1,000/1,001 bounds. Record evidence, no raw titles.
- [x] Write/run failing pure-state tests for deterministic shuffle, reconciliation, URL precedence, removed-item successor, local position validation, corrupt storage and session eviction.
- [x] Implement self-contained `createReelsState()` factory usable by Node tests and emitted browser script. Types: `ReelItem {postId,videoKey,title,durationMs,hasPoster}` and versioned session record without metadata.
- [x] Fixed-seed shuffle tests verify duplicate-free stable order and current pin. Reconciliation tests verify newly added items stay excluded and surviving order stays unchanged.

## Task 2: Data, routes and existing navigation

**Files:** `src/reels-context.ts`, `src/store.ts`, `src/index.ts`, `src/html.ts`, `src/limits.ts`, route/store tests.

**Interfaces:** renderer `renderReels(items: ReelItem[], context: ReelsContext, capacity?: boolean): string`; context includes validated `library`, `from`, `at`, `order`, `seed`, `pin`, `rs`, and whether an incoming session ID was supplied. URL helpers construct `/reels`, `/watch/:id?view=reels`, and original Library return from typed fields only.

- [x] Write/run failing tests: GET viewer 200/no-store, non-GET viewer403/owner405, missing identity403, unsafe query values ignored, escaped `</script>` titles, 1,001 capacity state.
- [x] Store projection applies valid post/media key eligibility before LIMIT; share Library filters/order; bound title and nullable duration, no resume/text in payload.
- [x] Add Library Reels entry at first eligible displayed card. Add Watch Back to Reels and Reels-origin delete/unavailable returns while ordinary Watch remains unchanged.
- [x] Verify owner/viewer Watch progress contract, Library return anchor and original query still pass.

## Task 3: Player and responsive view

**Files:** `src/reels-html.ts`, `src/reels-client.ts`, `test/reels-client.test.ts`.

- [x] Write/run failing media-controller checks: stale play promises, source reset cancellation, user pause, visibility loss, restore paused, zero writes.
- [x] Implement scoped charcoal/amber layout from approved preview: fitted media, native controls, order/shuffle, Reshuffle, Details, speed, mute, Previous/Next, Start fresh, notices/empty/capacity/loading/error states.
- [x] Wire state factory to sessionStorage (three records, validation, caught failures), replaceState, Details save, and fresh-response reconciliation including bfcache reload.
- [x] Use a three-slot snap track with inactive poster neighbors and exactly one source. Commit only settled target; guard recentering, focus/native interactions, rapid reversal and reduced motion.
- [x] Preserve keyboard semantics and accessible button/focus/live-region behavior. Native-control interactions must not become reel navigation.

## Task 4: Integration, browser QA and publication

**Files:** browser fixture/verification script if useful, `docs/research/2026-11-06-reels-implementation-qa.md`, ARCHITECTURE/PRODUCT, session docs.

- [x] Run `npm run check`; fix all failures.
- [x] Browser test actual short media through local authenticated handler fixtures: 320/390 desktop/landscape, playback, ordered/shuffle, swipe/buttons/keys, Details return, editing/deletion, storage loss, error/retry, hidden/visible, repeated navigation and source counts. Save representative screenshots. Never claim device-specific behavior from emulation.
- [x] Independent spec/security/lifecycle review; fix material findings and rerun affected checks.
- [x] Run whitespace, session and final type/test checks; record remaining phone-only release gates.
- [x] Commit with conventional message, push feature branch, open PR with verification evidence and explicit no-deployment status. No merge or deploy.

## Execution rulings

- 2026-11-06: Owner's explicit build instruction approves the proposed defaults and previews. Physical-phone validation remains required before release, but does not block building a reviewable PR. Preserve this distinction in PR and STATUS.
- 2026-11-06: Existing isolated worktree `legit-baboon` is reused. Baseline both typechecks and 97 tests passed.
- 2026-11-06: Claude adapter readiness rejects CLI2.1.291 for missing logs/attach; do not upgrade or bypass the adapter. Available native coding agents handle implementation/review.

- 2026-11-06: State/backend/final reviews complete, material findings fixed. Final local check: 136 tests, both typechecks, dry-run bundle VM check and session gate pass. Built-worker Chrome acceptance script passes all 25 checks. Actual phones remain a release gate.

- 2026-11-06: Published commit `2a655e9` on `feat/reels-view`, [PR #40](https://github.com/maneeshv/x-bookmarks-downloader/pull/40). No merge/deploy; physical-device gate remains.
