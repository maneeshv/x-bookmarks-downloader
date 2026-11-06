# Reels implementation verification

Date: 2026-11-06. [Spec](../superpowers/specs/2026-11-06-reels-view-design.md),
[plan](../superpowers/plans/2026-11-06-reels-view.md), ADR-0026.

## Baseline and sizing

Before changes, both TypeScript projects and all 97 node:test tests passed. The existing isolated
worktree is used on `feat/reels-view`.

A read-only remote D1 query on 2026-11-06 found 397 downloaded/nondeleted rows; all 397 matched
post/media-key eligibility. The proposed five-field metadata projection with normalized fallback
titles measured 66,955 UTF-8 JSON bytes after `<` escaping, under the 1,000-item/524,288-byte limits.
Only aggregate counts/bytes are retained; no production titles or metadata are committed.
This is a time-specific sizing measurement, not a claim that future unfiltered results stay bounded.
The exact implementation serializer and synthetic boundary checks are covered by route/store tests.

Sources: Wrangler execute syntax checked through Context7 `/cloudflare/workers-sdk` and
[execute source](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/d1/execute.ts).
During the original build, no migration, production metadata write or deploy was performed.

## Verification scope

Browser fixtures
use the actual request handler with in-memory D1/KV/R2 and synthetic media, never production tokens.
Real iOS Safari/Android Chrome, physical touch/native scrubbing and device audio carry-over cannot
be certified by desktop emulation; those remain required before release. The original build authorization excluded deployment. On 2026-11-06 the owner separately authorized deployment for hands-on testing; physical-device acceptance remains pending.

## Automated and browser results

- Unit/route/store coverage includes eligibility-before-limit, all Library filters/sorts, 1,000/1,001
  rows, 512KiB overflow, safe script escaping, viewer method restrictions, URL validation, deterministic
  shuffle, reconciliation/removed successors, three-session eviction, stale media promises, retry,
  native rate reset, focus, keyboard, storage loss and bfcache.
- `npm run check` includes both TypeScript projects, the node:test suite, a local-only Wrangler
  build plus emitted-factory execution, and the session gate. Final result: both typechecks, all 136 tests, bundle check and session gate passed.
- Built Worker tested in isolated headless Chrome 145.0.7632.117 (Node 25.4.0, macOS) with 24 synthetic playable videos, a missing-file
  fixture, portrait and landscape 12-second MP4s, and real Range responses from the production handler.
- Browser checks passed: page 2 enters at its first card while retaining full 24-item membership;
  Previous/Next, seeded Shuffle/reuse/Reshuffle; Details same-item/time paused return; original Library
  filters/page/card; wheel and emulated touch snap; one active source; 320×700, 390×844, 844×390 and
  1440×1000 controls without horizontal overflow; pause on resize; missing media retry; empty state;
  landscape contain; 1.5× speed through source reset; swipe after native player focus; native ArrowRight
  without reel navigation; real tab hide/show stays paused; no Reels mutation requests; title refresh;
  Delete successor return; missing storage fallback; viewer Details/no editor and POST 403.
- No uncaught browser exceptions. Screenshots visually inspected:
  [desktop](assets/2026-11-06-reels-implementation/desktop.png),
  [mobile](assets/2026-11-06-reels-implementation/mobile.png),
  [320px](assets/2026-11-06-reels-implementation/narrow.png),
  [landscape](assets/2026-11-06-reels-implementation/landscape.png).
- Independent state/backend/final review completed. Fixed first-shuffle constant seed, native playback
  speed resetting on load, and stale native-control focus blocking swipes. Final scoped review approved
  the fixes and bundle guard for PR.

## Build-only failure caught and fixed

Source tests passed, but Wrangler's default name preservation injected `__name` into serialized client
factories. The new bundle smoke check reproduced `ReferenceError: __name is not defined`; setting
`keep_names=false` made the check pass. The final browser run uses that actual built Worker, not just
source modules. This is encoded in the example configuration and CI under ADR-0026.

Two QA harness corrections were required: choose the active session by its `rs` (the storage holds
three records), and clear storage while on Details (clearing it on Reels is immediately followed by
an intentional page-exit save). Neither was a product defect. No production metadata was mutated.

## Repeat the local browser check

Generate synthetic fixtures with installed FFmpeg (CLI documentation checked through Context7):

```sh
mkdir -p /tmp/reels-browser-qa
ffmpeg -f lavfi -i testsrc2=size=360x640:rate=24 -f lavfi -i sine=frequency=220:sample_rate=44100 -t 12 -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -c:a aac -b:a 32k -movflags +faststart /tmp/reels-browser-qa/portrait.mp4
ffmpeg -i /tmp/reels-browser-qa/portrait.mp4 -frames:v 1 /tmp/reels-browser-qa/poster.jpg
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=24 -t 12 -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -movflags +faststart /tmp/reels-browser-qa/landscape.mp4
npm run check:bundle
REELS_QA_BUNDLE=.superpowers/reels-bundle/index.js node --no-warnings scripts/reels-preview.mjs /tmp/reels-browser-qa/portrait.mp4 /tmp/reels-browser-qa/poster.jpg /tmp/reels-browser-qa/landscape.mp4
```

In a separate terminal launch an isolated Chrome profile with `--headless=new`,
`--remote-debugging-port=19488`, `--user-data-dir=/tmp/reels-browser-qa/chrome-profile`,
`--no-first-run`, `--no-default-browser-check` and `about:blank`. Then run
`node scripts/reels-browser-qa.mjs` from the repo root. Restart the fixture server before repeating:
the check deliberately edits/deletes synthetic rows. Both listeners bind/use loopback only.
No browser dependency is added to package manifests. CDP methods checked through Context7 against
[Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/).

## Remaining release gate

Physical iOS Safari and Android Chrome: native touch scrubbing, swipe/reversal, unmute carry-over,
fullscreen/orientation, screen-reader focus, actual long/high-bitrate files and constrained-network
first-frame/bytes measurements. Desktop emulation and short fixtures do not establish those results.
The original build did not deploy or merge. The subsequent authorized testing deployment is recorded below; full physical-device acceptance remains pending.

## Combined testing deployment — 2026-11-06

Owner authorized deployment for hands-on testing, superseding the original no-deploy instruction. Integrated already-live PR #39 (`763ac15`, implementation `3699ff1`) into Reels PR #40. The thumbnail owner confirmed a deployment hold and no newer/live-only changes or migrations. Live version `2002eed9-d2db-4ac7-98d5-530f44514131` was at 100%; fetched source SHA-256 exactly matched the thumbnail release (`ef5f43d6f606e489832a493bd3868b19c79f1bb29df5109d3d7fd358c7fea354`).

Combined validation: both TypeScript projects, 171 tests, dry-run bundle execution, session gate and all 25 Chrome browser checks pass. Independent review compared both parents and approved; thumbnail/duplicate modules are unchanged, and both emitted scan handlers initialize in a VM with no requests on page load. Refreshed responsive screenshots remain readable. Native pause/resize QA initially called pause at readyState=0 before autoplay; a diagnostic confirmed the readiness race, and the harness now waits for actual playback. No production-code change was required.

Local config matches all live vars/resource bindings, domain and cron; restored missing OWNER_EMAIL from live settings without logging the value. keep_names=false remains essential for emitted Reels factories. No migration or production video/data mutation. Deployed source commit `95e2571ced8319a615cf7f484c8b2c9ac2d2fa51` as Worker `e9dcde25-bf50-4933-92de-f8cb6807a7bd`, 2026-11-06T11:58:56Z at 100%. The fetched live index.js exactly equals `.superpowers/reels-release/index.js` (SHA-256 `ab9e421ca0b85082c69c26db825d04a654575363af1f3718d061069b26d4b02e`). Live source contains Reels, Scan thumbnails, suggested-match heading and thumbnail API. All binding definitions, cron and disabled workers.dev/previews equal preflight. Signed-out curl: Library/Reels/Duplicates/thumbnail API302, workers.dev404. Native Arc opening `/reels` reached Cloudflare Sign in; signed-in production UI remains unverified. CI passed on the deployed commit (run42214147407). Rollback: `2002eed9-d2db-4ac7-98d5-530f44514131`.

Phone test: sign in, open Reels, unmute, swipe up/down three times, scrub/pause/fullscreen, try Shuffle and Details → Back to Reels. Desktop: Previous/Next, arrow navigation outside focused controls, and Library return. Confirm Scan thumbnails still appears under Duplicates. Physical-device sound persistence, native control gestures, screen-reader focus and long/high-bitrate constrained-network behavior remain pending.
