# Reels implementation verification

Date: 2026-11-06. [Spec](../superpowers/specs/2026-11-06-reels-view-design.md),
[plan](../superpowers/plans/2026-11-06-reels-view.md), ADR-0024.

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
No migration, production metadata write or deploy was performed.

## Verification scope

Browser fixtures
use the actual request handler with in-memory D1/KV/R2 and synthetic media, never production tokens.
Real iOS Safari/Android Chrome, physical touch/native scrubbing and device audio carry-over cannot
be certified by desktop emulation; those remain required before release. The owner authorized the
reviewable build/PR and explicitly excluded deployment.

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
source modules. This is encoded in the example configuration and CI under ADR-0024.

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
No deployment or merge was performed. PR review and physical-device validation must precede release.
