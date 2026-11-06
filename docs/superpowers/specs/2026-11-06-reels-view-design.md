# Reels: continuous browsing of saved videos

Date: 2026-11-06 | Status: PROPOSED

Evidence: [committee investigation](../../research/2026-11-06-reels-feasibility.md).
Scope: detailed product and technical design; implementation and deployment are separate work.
The owner requested this spec after reviewing the committee recommendation. The defaults below
are proposed together for review; this document does not mark them approved for execution.

## 1. Outcome and preservation contract

Add an independent Reels view where an admitted user can watch saved videos, swipe forward/backward,
choose ordered or shuffled playback, and visit Details without losing their browsing session.

The existing Library remains the place to search, filter, sort and locate videos. Existing card clicks
continue opening Watch. Reels reuses the selected Library result set; it does not replace Library or
turn Watch into a feed. A swipe changes the current video within one document, without a page load.

Preserve all existing behavior for users who never enter Reels: search, repeated-tag AND filtering,
favourites, sort options, pagination, posters, Watch playback/speed/keyboard controls, owner edits,
downloads, deletion, saved Watch progress, Stats, Queue and authorization. Watch receives only the
explicit Reels-origin navigation changes defined in section 7.

### First-version decisions proposed

| Topic | Contract |
|---|---|
| Content | One indexed playable file per downloaded, non-deleted post, matching Watch. |
| Access | Owner and existing admitted read-only viewers. No expansion of the Access admission policy. |
| Default order | Existing Library sort; direct entry defaults to newest. |
| Shuffle | Current filtered result set, stable within the browsing session, no repeated items. |
| End of clip | Loop that clip; advance only on an explicit navigation action. |
| Progress | Reels uses tab-session positions; it neither restores nor writes owner `resume_ms`. |
| Audio | Muted on a new session; explicit unmute, with playback-policy fallbacks. |
| Display | Fit the complete image; no default crop of portrait or landscape media. |
| Editing | Existing Watch page; no duplicate editor or metadata mutation controls in Reels. |
| Infrastructure | Existing Worker, D1 index, private R2 streams/posters; no new dependency or migration. |

Out of scope: recommendation algorithms, automatic next-video playback, every sibling attachment,
cross-device reel history, offline downloads, a service worker, public sharing, captions generation,
transcoding/adaptive quality, a new search UI, and a replacement frontend framework.

## 2. Entry, layout and basic navigation

Add a labelled Reels link to the Library desktop rail and compact navigation. It carries the current
validated search, tags, favourite filter, sort and Library page/page-size context. It opens in the same
tab. Existing cards retain their Watch links. A per-card Reels action is not required in this version.

The Library entry link sets both `at` and `from` to its first eligible displayed card when one exists.
Initial playback starts there, then navigates the complete eligible result set; earlier items remain
reachable with Previous. If that initial ID is no longer eligible and no stored session exists, use
the current eligible ordered offset `(page - 1) * perPage`, clamped to the final item. This fallback
does not claim to reconstruct a historical page. An empty set uses the empty state.
An eligible explicit `at` overrides entry defaults. A valid `from` marks a Library-origin entry;
without it, normalize return `page`/`perPage` to their defaults and treat entry as direct. Direct entry
without eligible `at` starts at the first item in the selected mode's sequence. Opening or swiping
Reels never replaces the saved `from` anchor. If Library has no eligible displayed card, its Reels
link may omit `from` and use direct-entry behavior with the selected filters.

The screen contains:

- A compact persistent header: Back to library, Ordered/Shuffle selection, and position `n of N`.
- One dominant video stage, sized to the available viewport below the header and above controls,
  accounting for mobile safe areas and browser chrome. Portrait and landscape use `object-fit: contain`.
- The current title, capped visually at two lines, and a Details link. Long text/tags belong on Watch.
- Native video controls, a labelled Mute/Unmute button, playback speed selector (Watch's 0.5×–2×
  choices), and labelled Previous/Next buttons. Fullscreen remains available where supported.
- A visible Reshuffle action in Shuffle mode. The controls remain reachable on a 320 px wide screen,
  in landscape, and with zoom; content may reflow rather than cover native controls.

Use the existing app typography, colours and icon conventions. Reels-specific CSS must be scoped.
No unrelated Library or Watch restyling is part of this work.

Swipe up moves forward; swipe down moves backward. Scroll-snap provides the vertical motion target.
The page must not have competing body and reel-stage scroll regions. Native scrubbing, volume,
fullscreen, browser navigation, pinch zoom and text selection must not be intercepted as reel gestures.
Visible buttons always provide an alternative if a device's native controls consume a gesture.

At the first item Previous is disabled. At the last item Next is disabled and an end-of-list indication
is visible; the playlist never wraps silently. Looping the active clip is independent of playlist ends.
After reaching the end, users can choose Reshuffle or Back to library. One-item results support playback
and Details, with both navigation buttons and Reshuffle disabled.

## 3. Playlist membership, order and sizing

Eligible rows have `status = downloaded`, no `deleted_at`, and a valid non-empty `r2_key` matching the
existing media-key rules. Filters use the existing query semantics; sort uses the same SQL order and
tie-breakers as Library. Missing files are not pre-probed in R2 for every item: media errors are handled
when encountered. No X request, sync, backfill or R2 inventory scan is triggered by opening Reels.

### Session snapshot

The initial response supplies one complete, bounded metadata list for the selected filters. This is a
snapshot of eligible membership for the session, not an infinite live feed. Keep two sequences: the
original Library order and the active display order. Newly downloaded or newly matching videos do not
insert themselves during browsing. A visible Start fresh action rebuilds from current server results.
Start fresh navigates to `/reels` without `rs`, retains filters/sort/original Library context and the
current `at`, and generates a new seed in Shuffle mode while dropping `pin`. It creates a new session
with fresh full membership and zero local positions; retains the current item if eligible, otherwise
uses section 2's entry fallback. It starts muted and attempts playback as a new explicit entry.
The old record remains subject to normal eviction. Start fresh is distinct from Reload, which
attempts to restore the existing session.

Ordered mode uses the saved Library sequence. Shuffle uses a seeded deterministic permutation of
unique IDs, with each included once. Generate a seed when entering Shuffle for the first time;
persist it in session state and the URL. The implementation must use one shared, versioned deterministic
shuffle routine, with fixed-seed tests, so the same IDs and seed reproduce the same order.
For version 1, sort unique decimal ID strings by length then lexicographically, remove an eligible
`pin`, and apply descending Fisher–Yates to the remaining IDs. Start a nonzero unsigned xorshift32
state from the seed; for each step apply XOR with left shift 13, unsigned right shift 17, then left
shift 5, normalizing to unsigned 32 bits. For index `i`, select `j = floor(state / 2^32 * (i + 1))`
and swap `i` and `j`. Prepend the pin if supplied. This is a reproducible browsing shuffle, not
cryptographic randomness; changing the algorithm requires a session-format version change.

Switching modes keeps the active item and its playback position; it changes the item's sequence index.
Switching back to Shuffle reuses its saved permutation. Reshuffle generates a new seed, places the
current item first and shuffles the remaining items; it does not reload or restart the current video.
Represent that pinned first item as `pin` in the URL so reconstruction has the same inputs. For one
item, order is unchanged. An invalid or ineligible pin is ignored.

### Explicit first-version bounds

Proposed constants: at most **1,000 items** and **512 KiB of UTF-8 serialized playlist JSON**, measured
after script-safe escaping. These are conservative product guardrails, not claims about measured
production size. They bound metadata only; they do not bound bytes downloaded by a playing video.

Fetch a projection of at most 1,001 eligible rows in one query using the existing ordering/filtering
plus the playable-row requirements above. Any count used for completeness must use the same eligibility
contract; the existing `countLibrary` alone does not exclude every invalid media-key row. Express
the media-key eligibility equivalently in SQL before applying LIMIT and test it against `VIDEO_KEY_RE`.
Do not validate only a limited candidate page in JavaScript, which can hide later eligible rows.
If the extra row exists or the encoded projection exceeds the byte budget, do not send a partial
playlist or enable Shuffle over a hidden subset. Render a normal authenticated page explaining
“This selection is too large for Reels. Narrow it in Library,” with a canonical return link. No media
request starts in this state. Return HTML 200; this is an application capacity state, not an auth error.
Capacity checks take precedence over restoring an older snapshot: retain the old record unchanged,
but do not display it as if fresh reconciliation succeeded.

Project only `postId`, `videoKey`, bounded display title, nullable `durationMs`, and `hasPoster`.
Construct same-origin video/poster/Watch URLs from validated IDs/keys. Do not include full post text,
description, tag arrays, raw database rows, aggregate file bytes, tokens or Watch resume values.
Use existing title fallback, with display titles bounded to 200 characters. Details supplies full data.

Before implementation planning is finalized, measure the current eligible count and projected payload,
plus synthetic 1,000/1,001-item cases. If the ordinary unfiltered library exceeds these limits, revise
this spec to a paginated design before building; do not ship a default Reels entry that only shows a
capacity message. No assumption that the lifetime archive stops at 800 or the Store default of 500 is valid.

## 4. Routes, URL contract and authorization

Add **GET `/reels`** inside the existing verified-Access router and explicitly to the viewer GET
allowlist. Keep every mutation route owner-only. An admitted viewer's non-GET `/reels` returns 403;
an owner's unsupported method returns 405. Invalid/missing identity remains governed by the existing
Access/Worker checks. The deployment does not change who is admitted by Cloudflare Access.

Return the page with `Cache-Control: private, no-store`. Continue serving media through the unchanged
authenticated `/v/:key` and `/p/:postId` routes, with existing Range and cache behavior.
This version has no playlist JSON endpoint and no new write endpoint.

| Parameter | Meaning / validation |
|---|---|
| `q`, repeated `tag`, `fav`, `sort` | Existing `parseLibraryQuery` rules and canonical serialization. |
| `page`, `perPage` | Original Library return context, parsed with existing rules; do not paginate Reels. |
| `from` | Original Library anchor post ID, validated with `POST_ID_RE`; absent is allowed. |
| `at` | Desired current post ID, validated with `POST_ID_RE`; absent/ineligible uses section 5 fallback. |
| `order` | `ordered` (default) or `shuffle`; any other value becomes `ordered`. |
| `seed` | Exactly 8 lowercase hexadecimal characters representing a nonzero unsigned 32-bit seed. Invalid/missing in Shuffle generates a new seed. |
| `pin` | Optional validated post ID for Reshuffle's first item; meaningful only with Shuffle. |
| `rs` | Opaque tab-session lookup ID: 32 lowercase hexadecimal characters. Invalid/missing creates a new ID. Not an authentication token. |
| `view=reels` | Watch-only origin marker; ignored by `/reels`. |

Retain decimal post IDs as strings; do not coerce them into unsafe JavaScript numbers. Ignore unknown
parameters. Validate session data as well as URL data; a malicious storage entry must not supply a
remote media URL, arbitrary redirect, HTML injection, role or write capability.

Construct all return URLs from these validated fields. Never accept `returnUrl`, an arbitrary path,
or an external destination. The `from` anchor is a convenience, not proof that a row exists on a page.
Use a new typed Reels context alongside existing Library query state, rather than overloading sort
with shuffle or changing the behavior of `libraryHref` for ordinary callers.

## 5. Session restoration and changing data

Store a versioned record in `sessionStorage`, keyed by `rs`: canonical filters/sort, original Library
context, ordered IDs, shuffled IDs/seed/pin, current ID/index, per-item local positions, audio/speed
preferences and explicit pause intent. Use fresh server metadata for display on document load;
do not persist title/text or credentials. Retain at most three sessions, evicting the least recently
used; clamp and validate positions and collection lengths on read.

Storage access can fail. Catch failures, keep the current page working in memory, and show a small
notice that position/order restoration after leaving the page may be limited. Do not fall back to
server writes or persistent `localStorage`. Session identifiers never grant access.

On each settled item, replace the current history entry with canonical `at`, mode, seed/pin and
session ID. Persist state on meaningful transitions (navigation, pause, seek completion, mode change,
Details exit and visibility loss), not every playback frame. A new reel creates no history entry.
An idle URL update must not unexpectedly navigate or scroll the page.

### Loading or returning to Reels

1. Require a fresh authenticated `/reels` response with the bounded eligible metadata list.
2. If `rs` identifies a valid record with matching canonical filters/sort, retain surviving saved
   sequences in their existing relative order. Intersect them with fresh eligible IDs and update display
   metadata. Exclude new members until Start fresh. A playback error alone does not remove an ID.
3. URL `order` is authoritative. In Shuffle, a URL seed/pin matching the saved permutation reuses it;
   a different valid seed/pin rebuilds the permutation over surviving snapshot membership and announces
   the order change. Missing/invalid Shuffle seed generates a new one. Ordered mode uses saved ordered
   IDs without discarding the saved Shuffle permutation. Persist the resolved mode/seed/pin and URL
   together. This does not admit newly matching items.
4. An eligible `at` already in the restored sequence wins; otherwise use the saved current item if it
   survives. If it was removed, choose the first surviving item after its old index, then the nearest
   surviving predecessor. If none survive, show “No videos remain in this session,” with Start fresh.
5. An explicit `at` that is eligible in server results but absent from the saved snapshot starts a fresh
   session anchored there, with a visible “Browsing session refreshed” notice. This avoids silently
   mutating a saved shuffle when opening a direct link.
6. If storage is absent, invalid, mismatched or evicted, reconstruct from fresh server results and the
   URL seed/pin, keeping eligible `at`. Otherwise choose the entry item from section 2. The same seed
   reproduces order only for the same membership; announce a restored-session fallback when `rs` was
   supplied but could not be restored. Do not promise exact previous order or time after storage loss.

Back/forward-cache restoration must not bypass reconciliation. On a persisted `pageshow`, pause the
player and perform one full reload of the canonical Reels URL; a normal load must not reload again.
Persist local state before leaving. This favors fresh authorization/metadata over an instant stale
restore and must be tested to avoid a reload loop. An ordinary reload attempts the same restoration.

Returning after Details or a reload restores local position but remains paused with a visible Play
control. Background/foreground also stays paused on return. Explicit navigation to a different reel
is a new request to attempt playback; incidental scroll settling on the same item is not.

## 6. Playback lifecycle and resource limits

Maintain at most **one video element with a media source**. Poster neighbours may occupy the previous
and next slot; no more than three poster sources are attached simultaneously. Do not fetch adjacent
video bodies, store video blobs, or preload a long run of clips. Reuse the existing private posters
and placeholder behavior. Browser caching may retain fetched bytes; source counts are not cache limits.

The implementation target is a three-slot native vertical snap track with the one active player in
the settled slot. On a committed navigation, recycle poster slots and recenter without generating a
second navigation event. Use an explicit “recentering” state and one controller for every input path.
Do not move or recreate a focused native control during an active interaction. The device spike in
section 11 must demonstrate this placement before production code adopts it; if it fails, revise the
spec to the fixed-player alternative rather than silently changing the promised interaction.

Commit a swipe only when its target is settled; partially visible neighbours never start playback.
Rapid reversals use the latest committed target. Button and keyboard actions move exactly one item.
Scroll inertia must not start several clips in succession. The active item/index announcement happens
once per committed transition, not on every observer callback.

For every source change:

1. Capture outgoing ID, finite position and user playback intent before changing source/state.
2. Pause the outgoing clip, invalidate its callbacks with a generation identifier, remove its source
   and reset media loading. Intentional cancellation is not an error state.
3. Update active identity, title, poster, URL and controls from validated metadata; set the new source.
4. Apply session mute/speed preference. Load metadata, restore this item's local position if available,
   clamped to actual finite duration; otherwise start at zero. If saved position is at/past the end,
   restart at zero. Unknown duration means no unsafe seek.
5. Attempt playback only when the page is visible and the transition permits it. Inspect the `play()`
   promise and ignore results from stale generations. Use actual media state to show Play/Pause.

### State and event contract

| State/event | Required behavior |
|---|---|
| Initial valid entry | Start muted, attempt inline playback; show poster while loading. |
| Playing | Only the current source can emit audio; native seeking and speed remain usable. |
| User pause | Preserve pause for that item until explicit Play or navigation to a different item. |
| Waiting/stalled | Keep controls, show buffering indication, allow Retry and Next without waiting. |
| Autoplay denied | Keep position, show Tap to play; do not label it a missing video. |
| Unmuted playback denied | Try muted once, visibly show muted/Tap for sound; if that fails, require Play. No retry loop. |
| Ended | Loop current clip only when playback was intended and page is visible. Never move to next. |
| Hidden/page exit | Capture position, pause immediately, invalidate pending play attempts. |
| Visible again | Remain paused, restore controls, no spontaneous sound. |
| Source/decode/network error | Show generic playback failure, Retry, Next and Reload; keep the item in the session. |
| Fullscreen | Native video interaction owns gestures; keep current reel until fullscreen exits. |

Mute preference lasts for the tab session, subject to browser policy. A failed unmuted attempt that
falls back to muted updates the visible actual state; it must not claim sound is on. Explicit pause is
separate from programmatic pause during switching/backgrounding. Retain local positions when revisiting
items with Previous; loop playback does not modify Watch progress. Reels sends no metadata POSTs.

## 7. Details, edits, deletion and Library return

Details pauses and saves the reel's local state before navigating to `/watch/:postId` with the
canonical Library context and validated Reels fields plus `view=reels`. Watch retains its existing
playback behavior: owner Watch progress can still be read/saved there. Reel local time is not copied
to owner progress or used to override Watch resume. Display this distinction through normal navigation,
not a new progress setting.

For a valid Reels-origin Watch URL:

- Add Back to Reels, reconstructed from validated context and `at` equal to the viewed post ID.
- Keep Back to library and all existing editing, download and playback controls. Ordinary Watch URLs
  retain exactly their existing return and deletion semantics.
- Save/favourite/tag changes stay on Watch and use existing validation and permissions. Returning to
  Reels reloads metadata and reconciles eligibility; surviving session order does not change after a title edit.
- A successful owner Delete redirects to the reconstructed Reels URL, carrying the deleted `at` so
  restoration chooses the successor described in section 5. Failed/cancelled deletion stays on Watch.
  A non-Reels-origin successful Delete still returns to Library as it does before this feature.
- If Watch is requested for an already unavailable ID with valid Reels context, return a 404 page
  containing Back to Reels and Back to library links; do not strand the user on plain text. Do not expose
  deleted metadata. Ordinary invalid Watch requests keep their existing behavior.

Back to library from Reels restores the original `q`, tags, favourite, sort, page and page size, plus
the original `from` card anchor when available. Do not substitute the current shuffled video's ID
onto the originating page. The Library's existing page clamping handles a page shortened by deletion.
From a direct Reels entry without an origin, return to page 1 with the active filters/sort.

Browser Back after a run of swipes exits that Reels history entry. Browser Back from Watch returns to
the current Reels entry; an explicit Back to Reels is a normal safe link and may add an entry. Exact
session restoration is provided by the session record, not by assuming a particular history stack.

## 8. Accessibility, keyboard and failure states

Provide semantic buttons/links, visible focus rings, at least 44 px primary touch targets, readable
contrast, and a polite current-item announcement (`Video n of N: title`). Do not announce time updates.
Off-screen slots are neither focusable nor exposed as duplicate players. Keep focus on the initiating
navigation control; gestures do not forcibly move keyboard focus. Never recycle a node that owns focus.

Outside native controls, links, buttons and editable fields: ArrowUp/PageUp = Previous;
ArrowDown/PageDown = Next; Space/K = play/pause; J/L = seek ±10 seconds; Left/Right = seek ±5 seconds;
M = mute; F = fullscreen; `<`/`>` = adjacent speed option. Ignore modified shortcuts and preserve
native-control keyboard behavior. Prevent double actions from both browser scroll and key handlers.
Reduced-motion mode uses immediate transitions without decorative movement. Pause always remains
available even when clip looping is enabled.

| Situation | UI and recovery |
|---|---|
| No eligible results | “No videos match this selection.” Back to library with filters intact. No player source. |
| No survivors in restored session | Explain that the session is empty; offer Start fresh and Back to library. |
| Capacity exceeded | Section 3 message; return to Library to narrow selection. No truncated feed. |
| Missing poster | Existing placeholder; video can still play. |
| Slow media | Poster/buffering indicator; controls and Next remain responsive. |
| Playback failure | “This video could not be played.” Retry current source, Next, or Reload. |
| Session storage blocked/corrupt | Continue in memory, explain limited restoration, never crash the page. |
| Failed page load / expired admission | Existing Access flow or server error; preserve canonical URL for retry. |
| JavaScript unavailable | Server-rendered explanation and link to Library/Watch; no nonfunctional swipe controls. |

Do not infer HTTP status or authentication expiry from a generic video error. No extra diagnostic
media request is required in this version. Retry resets only the current source and retains valid local
position; Next remains user-controlled. Do not automatically skip a video the user intended to watch.

## 9. Code organization, security and dependencies

Keep route validation/authorization in `src/index.ts`; add a projected Reels-list method in Store,
sharing filtering/ordering with Library. Do not change Library's existing pagination method into an
unbounded query. Put Reels rendering and its controller in dedicated modules so this work does not
expand the large Watch inline script. Small shared URL/query helpers may be extracted with preservation
tests; unrelated refactoring is outside scope. Use absolute imports and existing npm tooling.

Keep playlist/order/reconciliation logic independent of DOM/media operations for meaningful unit tests.
Media controller state transitions need controllable media/event doubles or browser tests; string
presence assertions alone are insufficient. Stay with existing tooling until a demonstrated test need
justifies a dependency and its ADR. No client framework is assumed necessary.

Escape HTML and embedded JSON with the existing safe conventions, including `<` in serialized script
data. Reject invalid post IDs/media keys before constructing URLs. Do not trust storage as authorization.
No secrets, identity tokens or raw source URLs enter playlist state or logs. Media and posters remain
private and same-origin. Client errors must not log complete search queries or playlist contents.

After spec approval, record a new ADR covering the new read-only route, navigation/session contract,
and framework-free implementation, explicitly relating it to ADR-0006/0016/0019/0022. Do not edit frozen
ADRs to imply this behavior already exists. ARCHITECTURE and PRODUCT change with implementation,
not with this proposed spec. No migration, new Cloudflare service or scheduled work is introduced.

## 10. Acceptance criteria

| ID | Given / action | Required result |
|---|---|---|
| R01 | Existing Library or ordinary Watch usage | Every preservation-contract feature remains functional. |
| R02 | Search + two tags + favourite + nondefault sort, page 2 → Reels | Complete filtered membership, correct order, starts at page 2's first eligible result. |
| R03 | Swipe next/previous repeatedly | In-document navigation, exact preceding item reachable, no simultaneous audio. |
| R04 | Shuffle entire eligible set | Each ID appears once; Previous is reversible; no silent page-sized subset. |
| R05 | Mode switch / Reshuffle | Current clip and time retained; deterministic sequence rules and URL state applied. |
| R06 | Details → Back to Reels | Same surviving item, sequence and local time; returned player is paused. |
| R07 | Owner changes a title/tag/favourite or deletes on Watch | Fresh metadata, stable surviving order, deterministic replacement or empty state. |
| R08 | Ordinary Watch Delete versus Reels-origin Delete | Library return for ordinary flow; Reels return for Reels flow. |
| R09 | Swipe many times, then browser Back | Does not step backward through every swipe. |
| R10 | Storage unavailable or new tab link | Browsing works; seed/current item fallback is honest about restoration limits. |
| R11 | User pauses, resize/observer fires, or tab hides/shows | No unwanted restart or background audio. |
| R12 | Autoplay rejects / source fails / rapid reversal | Accurate controls, actionable fallback, no stale event changes the active item. |
| R13 | Read-only viewer enters Reels and Details | Can browse/play; no owner mutations or progress writes become available. |
| R14 | Invalid identity, non-GET viewer request, arbitrary return URL, corrupt storage | Existing denial rules and safe reconstruction; no external navigation or role escalation. |
| R15 | 1,000 rows within budget / 1,001 rows / oversized escaped payload | Complete feed / explicit capacity state / explicit capacity state respectively. |
| R16 | Empty, one-item, null duration, missing poster, landscape media | Defined empty/boundary/fallback layout without inaccessible controls. |
| R17 | Keyboard, screen reader, reduced motion, zoom and native scrubbing | No trapped focus, duplicate activation or gesture-only functionality. |
| R18 | Observe Reels traffic and progress data | One active video source, no next-body prefetch, no X calls or metadata POSTs; Watch resume unchanged by Reels. |
| R19 | Back to Library after Shuffle | Original filters/page/page size/card context restored, not page 1 by default. |
| R20 | Persisted page restored from browser cache | One reconciliation reload, no reload loop, restored player paused. |

## 11. Validation gates and release boundaries

### Before production implementation

Record playlist count/payload measurements and synthetic boundary results against section 3. Build a
small disposable interaction prototype after approval for that work. Test on actual iOS Safari and
Android Chrome: native-controls swipes, scrubbing, rapid direction reversal during loading, player
recycling/focus, muted start, unmute across several clips, landscape/fullscreen, visibility loss, and
Details/Back. Use representative short and long/high-bitrate clips on both normal and throttled networks.
Record browser/device versions, first-frame delay, buffering and transferred bytes; do not invent a
latency guarantee from a desktop emulator. If either target fails essential controls, revise the design.

### Implementation verification

Run both TypeScript checks, existing tests and `scripts/check-session.sh` through `npm run check`.
Add Store/route tests for projection, completeness/budgets, matching filters/sorts, allowlist/method
rules and escaping, including invalid/null media keys ahead of valid rows and capacity overflow on
session restoration. Add pure-state tests for fixed shuffle vectors, Start fresh, URL/session conflicts,
mode changes, restoration, removal, fallback,
position clamping and stale-event isolation. Add navigation tests for every Watch return/deletion branch.

Browser QA must exercise actual playback and failure events, network source counts, no hidden audio,
native focus/scrubbing, reduced motion, and all restoration cases. Test at 320 px, a typical mobile
portrait viewport, mobile landscape and desktop. Unit tests cannot substitute for device media-policy QA.
Validate source/URL authorization using owner, viewer and invalid-identity fixtures without writing
production metadata. Existing signed-in production smoke requirements still apply at release.

The release gate is all acceptance criteria passing, with device results recorded and no required
gesture/playback test left unverified. No performance result or implementation completion is claimed
by this spec. Deployment remains a separate authorized action following the existing deploy runbook.
Because there is no schema change, rollback uses the previous verified Worker version; client storage
is versioned and safely ignored by older code. Never relax Access or publicize R2 to solve playback issues.

## 12. Review points

Approval should cover the proposed choices in section 1 and the explicit capacity behavior in section 3.
In particular: Library-parity content, separate local progress, looping current clips, viewers included
read-only, and a bounded complete playlist. Existing owner questions remain in [QUESTIONS](../../QUESTIONS.md)
until resolved; no unspoken answer is treated as approval. The current 1,000-item/512 KiB proposal
must pass sizing validation before it becomes an implementation assumption.

Further browser evidence used while writing this spec: MDN
[sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) and
[Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API), fetched
through Context7 `/mdn/content` on 2026-11-06. Other platform evidence is linked in the committee report.
