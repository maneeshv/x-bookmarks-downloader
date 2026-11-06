# Reels immersive mode implementation plan

> **For agentic workers:** Use subagent-driven implementation with independent review. Existing isolated feat/reels-view worktree. Do not deploy or merge.

**Goal:** Give Reels an optional viewport-filling swipe experience with tap-toggle overlays.
**Architecture:** Reuse the one video, snap track, controls and session. Add page-local presentation lifecycle to the existing browser wiring and immersive CSS/markup. Container Fullscreen API is progressive enhancement over a fixed 100dvh fallback.
**Tech Stack:** TypeScript Worker renderer, inline vanilla browser JS, CSS, node:test and existing synthetic browser harness. No dependencies.
**Spec:** ../specs/2026-11-06-reels-immersive-design.md

## Constraints
Keep already-live thumbnail/duplicate code untouched. Absolute imports. Native controls stay in normal mode. No forced video-only native fullscreen. No session/data mutation caused by presentation changes. Final authorization is build/test/commit/push PR40, NOT DEPLOY. CI is test-only (typecheck/test/check:bundle); check:bundle uses dry-run.

## Task 1 — presentation lifecycle and UI
Files: src/reels-client.ts, src/reels-html.ts; test/reels-immersive.test.ts (new), existing Reels tests where affected.
- [x] Write failing behavior tests using the existing VM/browser-script or pure-function style: fullscreen rejection fallback, native exit, late entry resolution after exit, tap vs drag/cancel/control, hidden control focus and unchanged media state.
- [x] Run targeted node --test and observe feature-missing failures before source edits.
- [x] Add Full screen/Exit controls, overlay grouping, seek/time control and safe-area viewport CSS; keep default layout intact.
- [x] Implement page-local entry/exit, async request cancellation/reconciliation, overlay visibility/focus, pointer tap discrimination and scrubber wiring. Use the current controller for playback/seek actions, never reset src to enter/exit.
- [x] Adjust existing fullscreen navigation guard so root fullscreen permits swipes; preserve video-only native fullscreen guard in normal mode. F toggles immersive; Escape exits before target filtering.
- [x] Run targeted tests/typechecks and emitted bundle check.

## Task 2 — real browser QA and review
Files: scripts/reels-immersive-qa.mjs (new if helpful), docs/research/2026-11-06-reels-immersive-qa.md, screenshot assets.
- [x] Exercise built Worker locally with synthetic data: full viewport at four sizes, tap twice, swipe/wheel, control/range actions, keyboard Tab/Escape, denied/missing fullscreen API, browser fullscreen exit, aspect ratios, state preservation and paused return.
- [x] Run existing 25 browser checks against a fresh fixture and inspect screenshots of normal/immersive/hidden/mobile/landscape.
- [x] Independent review against approved spec; fix findings with focused regression tests.

## Task 3 — publication only
Files: ADR0027, ARCHITECTURE, STATUS, JOURNAL, QA evidence, PR40.
- [x] Record browser/platform limits and implemented behavior. Run npm run check and git diff --check.
- [x] Verify CI has no auto-deploy step, commit conventionally and push feat/reels-view. Update PR40 to distinguish previous live release from undeployed immersive increment.
- [x] Verify CI result and clean worktree. No merge, deploy, production scan or media mutation.

Publication: `a258d6b`, PR #40 updated; CI run42222304781 passed. Immersive mode NOT DEPLOYED. Physical device limits are recorded in QA, not marked as tested.
