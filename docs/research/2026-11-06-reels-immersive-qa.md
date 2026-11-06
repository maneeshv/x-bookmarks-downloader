# Reels immersive mode — verification
Date: 2026-11-06. [Approved addendum](../superpowers/specs/2026-11-06-reels-immersive-design.md), ADR0027.

## Scope and authorization
Optional Full screen mode, preserving the existing Reels view and the already-live duplicate/thumbnail features. Owner's final instruction: **do not deploy**. This increment is local build/test + commit/push PR #40 only; no merge, production data mutation, remote scan or deployment. `.github/workflows/check.yml` was inspected before publication: it runs tests/typechecks and `check:bundle`, whose Wrangler invocation is `--dry-run`.

## Automated verification
Both TypeScript projects, all 181 node:test tests, isolated execution of emitted browser factories, and session gate pass. New behavioral tests first failed for the absent presentation implementation. Additional regressions first failed for transient buffering revealing hidden overlays and asynchronous fullscreen exit canceling the latest re-entry intent; both pass after fixes. Independent review approved after reproducing/rechecking the exit race; reviewer independently passed 28 targeted tests.

The presentation factory has no media/session access. DOM-wiring tests also compare actual fake media source/time/paused/mute/speed/load count and URL across mode changes. Existing thumbnail/duplicate code is untouched. No dependencies or migrations.

## Browser evidence
Chrome 145, actual dry-run Worker bundle, synthetic video/poster fixtures and in-memory D1/KV/R2. Reproducible harnesses: `scripts/reels-preview.mjs`, `scripts/reels-immersive-qa.mjs`, `scripts/reels-browser-qa.mjs`. Start a fresh fixture before each suite because the original suite intentionally edits/deletes synthetic rows. No private videos or tokens used.

The original 25 Reels checks pass with the immersive implementation: complete filtered membership, ordering/shuffle, Details state/edit/deletion returns, native playback/speed/focus, gesture/keyboard navigation, pause/background, storage fallback and viewer access. All 23 immersive browser checks pass. They cover:
- denied and unavailable fullscreen fallback; exact paused media/session state across entry/exit;
- 320x700, 390x844, 844x390 and 1440x1000 viewport coverage, contained controls, >=44px Exit, no body/horizontal overflow;
- single tap hide/restore, persistent Exit, hidden+inert overlays, Tab reveal and available focus;
- actual pointer control activation, keyboard and pointer scrubbing without navigation/toggle;
- touch swipe and wheel across video while overlays remain hidden, one active media source;
- Escape from a control, F toggle, restoration of native controls and entry focus;
- uncropped landscape source in portrait viewport;
- real container fullscreen, native fullscreen exit, rapid Exit→Enter retaining latest intent as viewport fallback;
- missing-media recovery reveals Retry controls; immersive Details round trip restores same reel paused in normal mode;
- no Reels metadata/progress writes and no uncaught browser exceptions.

The write assertion runs before visiting Details: Watch's pre-existing owner resume-saving remains valid and must not be misreported as a Reels write regression. Actual browser rapid Exit→Enter reproduced `{active:false,native:null}` before the fix. The new regression retains active viewport fallback after the old native exit finishes.

## Visual inspection
Inspected mobile, hidden-controls, narrow and short-landscape captures. Video fits without cropping, gradients maintain overlay contrast, Exit stays visible, and controls stay within bounds. Fixed pressed Mute contrast where an immersive background override left dark text on a dark button. Captures use synthetic colour bars for repeatable playback, not real Library media.

- [Normal mobile](assets/2026-11-06-reels-immersive/normal-mobile.png)
- [Immersive mobile](assets/2026-11-06-reels-immersive/mobile.png)
- [Hidden overlays](assets/2026-11-06-reels-immersive/mobile-hidden.png)
- [Narrow](assets/2026-11-06-reels-immersive/narrow.png)
- [Landscape](assets/2026-11-06-reels-immersive/landscape.png)
- [Desktop](assets/2026-11-06-reels-immersive/desktop.png)
- [Landscape video](assets/2026-11-06-reels-immersive/landscape-source.png)
- [Recovery](assets/2026-11-06-reels-immersive/recovery.png)

## Limits
Physical iOS Safari/Android Chrome, mobile browser chrome/safe-area behavior, assistive technology, audio carry-over and long/high-bitrate media on constrained networks are not certified by desktop emulation. No signed-in production validation of this increment: **NOT DEPLOYED**. The earlier combined release remains the last recorded live version; no new production verification was needed for this local-only task.

## Publication
Source `a258d6b`, pushed to PR #40. CI run42222304781 passed in31s. Temporary browser/fixture processes stopped after verification. This increment remains **NOT DEPLOYED** and unmerged.
