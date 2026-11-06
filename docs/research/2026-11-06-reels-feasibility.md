# Reels view: committee feasibility investigation

Date: 2026-11-06. Analysis only; no implementation approval, product changes, deployment, or device testing.

## Outcome

A separate `/reels` view is feasible on the existing Worker, private video storage, and HTML renderer.
Preserve Library search/filter/sort/pagination and the existing Watch/details experience. Add a client-side
vertical browsing session: swipe up for next, down for previous, with ordered and shuffled modes.
No framework, media service, or migration is needed for parity with the videos Library already exposes.
Server work is still necessary to supply playlist metadata and explicitly authorize the new read route.

Committee: Claude Opus 5.5 and GPT-6-Astra, both high reasoning, launched through the Paseo committee
workflow after provider discovery (no configured profiles). Both inspected the source independently,
then accepted the combined proposal in cross-review. This report records recommendations, not an approved spec.

## Experience recommended for the first version

- Enter Reels from Library with the current search, tags, favourites and sort. Direct entry defaults
  to the complete eligible library in newest order. Preserve the originating Library page/card separately.
- One screen per video, vertical snap-scrolling, with visible Previous/Next and keyboard alternatives.
  Keep native playback controls initially. Fit portrait and landscape media without cropping.
- Ordered mode follows Library order. Shuffle chooses a stable order without replacement for the session;
  Previous returns to the actual preceding video. Reshuffle is explicit. Mode changes retain the current item.
- Attempt muted inline playback, offer Unmute and a visible tap-to-play fallback. Remember the sound
  preference for the session, but never promise that one tap unlocks audible playback for every later video.
- Recommend looping the current clip until the user swipes; no automatic advance. Native Pause remains
  usable, and incidental observer/visibility events must not undo an explicit pause.
- Details opens the existing Watch page. Add a validated Back to Reels link while retaining Back to library
  and all existing Watch controls. Return to the same session/item without making every swipe a history entry.
- Start newly encountered reels at zero; optionally retain positions within the tab session. Reels does
  not read or write owner `resume_ms`. Watch keeps its existing progress behavior.
- Empty, loading, playback-blocked and unavailable states need explicit UI. A failed item offers Retry,
  Next and a way to reload/sign in; an unexplained media error is not proof that authentication expired.

## Source evidence

| Source | Finding and implication |
|---|---|
| `src/index.ts:112`, `src/store.ts:32` | Existing validated Library queries and deterministic sort tie-breakers can be reused. |
| `src/index.ts:142` | Viewers are restricted to a positive GET allowlist. Add `/reels` explicitly; do not open all API paths. |
| `src/index.ts:198` | Library and Watch return HTML; there is no playlist read API to reuse. Embedding a lean playlist in `/reels` is the simplest initial option. |
| `src/index.ts:43` | `/v/:key` already streams Range/206 responses with private caching. Seeking support does not prove instant startup or adaptive quality. |
| `src/html.ts:177`, `src/html.ts:215` | Watch reconstructs Library return URLs and saves owner progress. Reel return context is additive; viewer progress writes stay forbidden. |
| `src/store.ts:131` | `listLibrary` defaults to 500 rows. Calling it without an explicit completeness strategy would silently truncate Reels. |
| `src/x.ts:18`, `src/limits.ts:8` | Downloader chooses the highest-bitrate MP4; allowed size has a 5 GiB ceiling. Mobile data and startup delay are material risks. |
| `src/sync.ts:167` | One `r2_key` represents the first successfully stored file per post; other saved siblings are not individually indexed. `bytes` can aggregate siblings. |
| `src/limits.ts:16`, `src/store.ts:56` | The 800 limit bounds an X backfill, not the accumulated archive. Do not size the lifetime library from that limit. |
| `test/index.test.ts` | Existing coverage protects authorization, Range, Watch controls and URL state; markup assertions do not verify touch or media lifecycle behavior. |

The 256 downloaded count in the 2026-10-31 journal is historical. No current production count,
playlist payload size, streaming performance, or production deployment was checked in this investigation.

## Implementation direction and boundaries

Use a dedicated renderer/client controller for Reels with shared existing query/URL helpers. Keep one
active media element, and a bounded set of poster-only neighbours. Native vertical scroll-snap is the
interaction target; placement/recycling of the active video is deliberately a device-spike question.
Do not render an archive full of live videos or preload every video body. No adjacent video-body
prefetch in the initial version; measure before adding it. Posters should also load within a bounded window.

Capture outgoing item identity/time before resetting its source. Pause/detach old media, invalidate
pending playback callbacks, and prevent late events from updating the new item. Pause when backgrounded.
An intentional cancellation during a swipe must not appear as a playback failure. Only one clip may
play at a time. Respect control focus, reduced motion, explicit pause, and screen-reader navigation.

Prefer a lean snapshot of eligible ordered IDs/metadata if measured payload size permits it. Preserve
the actual session order/index for Details/Back. URL state includes current item, validated filters,
mode and a seed for deterministic reconstruction. A seed stabilizes ordering for the same set; it
does not freeze membership when downloads/deletions change the archive. If session storage is missing,
rebuild, retain the requested item if eligible, and allow ordering to change with an explanation.

Measure the current library count and serialized payload before fixing a snapshot budget. If a limit
is necessary, disclose it and its shuffle scope; do not call a shuffle of the first N items a whole-library
shuffle. Beyond the budget, explicitly design stable pagination rather than shuffling each page or
assuming live OFFSET pagination preserves membership. Any additional JSON endpoint needs its own
GET-only viewer authorization and tests. This choice remains open until measurement.

Watch must reconstruct Back to Reels from validated fields, not accept an arbitrary return URL.
Use replacement history entries during swipes. On Details return, reconcile edits/deletion without
reshuffling surviving entries; for a known removed/ineligible current item choose a deterministic
successor and handle an empty playlist. For an unexplained media failure, show Retry/Next rather than
silently deleting the item. Persisted client metadata is display state, never authorization.

Keep the initial scope to the same playable file per post as Library. Browsing every saved sibling
would need reliable per-file inventory/identity and separate design; guessing numbered R2 keys is insufficient.

## Alternatives and how disagreements were resolved

| Approach | Assessment |
|---|---|
| Dedicated client-side `/reels`, snap-scroll, one active player | Recommended: matches the requested flick-through flow while reusing storage/auth. |
| Fixed player with gesture-triggered next/previous | Simpler fallback if moving/recycling the player proves unreliable, but less continuous visual motion. |
| New page navigation per swipe | Adds reload latency and complicates sound continuity/history; weak fit for the requested experience. |
| Library overlay or full frontend rewrite | Overlay is possible but couples this work to Library state; a framework does not resolve autoplay/buffering. Neither is needed initially. |

Claude initially preferred a poster scroll track, seeded order, and an information sheet; Codex preferred
a minimal player, session snapshot, native controls and explicit Details return. Both accepted native
snap-scrolling as the target, one active player with placement tested on devices, session snapshot plus
seeded fallback, native controls first, and an additive Back to Reels instead of another details UI.
Both accepted loop-current/manual-next as the proposed default. Exact restoration after session loss
or membership changes is explicitly outside the guarantee.

## Platform evidence and practical limits

- [MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) and
  [play()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play), fetched through
  Context7 `/mdn/content`: script playback is subject to browser policy; handle rejected promises and
  show user controls. Muted inline playback is an attempt, not an unconditional guarantee.
- [MDN video](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video), fetched
  through Context7: `preload` is only a hint; `auto` can fetch the complete file. Bounding sources
  matters more than trusting a preload attribute as a byte budget.
- [MDN scroll snap](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_snap/Basic_concepts)
  and [scroll-snap-stop](https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-snap-stop), fetched
  through Context7: snapping supports vertical navigation, but mandatory snapping can make overflowing
  content inaccessible. Keep reel content bounded and long details on Watch.
- [MDN load()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/load) and
  [replaceState](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState), cited by the
  Codex reviewer: resetting media affects pending operations; replacing history avoids swipe-by-swipe Back.
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), checked through Context7 by
  the Codex reviewer: R2 egress through Workers is free, but reads and Worker requests remain metered.
  No bill or request-count estimate was measured here. Viewer bandwidth/battery are separate costs.
- [WebKit iOS video policies](https://webkit.org/blog/6784/new-video-policies-for-ios/), cited by the
  Claude reviewer, explain relevant policy history; they do not establish behavior on the owner's device.

No new X requests are needed for browsing saved clips. No transcoding/adaptive-bitrate pipeline is
proposed. High-bitrate originals and slow connections can still buffer; a polished interface cannot
guarantee the same startup latency as a service delivering optimized renditions.

## Follow-up validation and owner choices

Before a final implementation design: measure playlist size and make a small device spike covering
iOS Safari and Android Chrome, using representative portrait/landscape and large files. Verify swipe
over video and controls, scrubbing, rapid direction reversal while loading, unmute continuation,
background/foreground, explicit pause, focus while recycling, Details return, and slow/error states.
Desktop responsive QA alone cannot establish phone media behavior.

Eventual automated coverage: filter/order parity; stable shuffle and reconstruction; missing/deleted
items; escaping embedded JSON; no viewer writes; narrow route allowlist; original Library/Watch URLs;
late media callback isolation; and no Watch progress mutation from Reels. Run `npm run check` and
browser/device QA. Tests do not require choosing a new framework before assessing existing tools.

Proposed defaults for owner review: current Library-playable files, current filters, loop-current/manual-next,
separate session progress, admitted viewers included read-only, all durations allowed. The two scope
choices with the largest effect are every sibling file versus Library parity, and shared Watch resume
versus separate reel progress. No ADR is issued until the direction is selected; later decisions must
record access/navigation changes and the framework-free choice against ADR-0006/0016/0019/0022.
