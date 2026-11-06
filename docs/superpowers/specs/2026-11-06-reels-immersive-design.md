# Reels immersive Full screen mode
Status: APPROVED — owner request relayed 2026-11-06. Addendum to the existing Reels design.

## Outcome and scope
Retain the deployed Reels experience and add an explicit Full screen button. In that mode the video/swipe track occupies the entire available viewport; controls overlay it. Preserve the same video element, current item/time, playback intent, mute/speed, playlist and navigation. No server/data/API/dependency changes. Build, test, commit and push PR #40 only. **Do not deploy or merge.** The owner's final no-deploy instruction supersedes earlier deployment authorization for this increment.

## Interaction
- Full screen enters a fixed full-viewport layout immediately, then attempts `requestFullscreen()` on the containing Reels element from the user gesture. Unsupported/rejected requests retain the usable viewport layout. Never call video-only fullscreen to implement this mode.
- Native fullscreen exit (including browser Escape) returns to the existing layout. The visible Exit full screen button and Escape also exit fallback mode, restore normal native video controls, and return focus to the entry button. Entry/exit must not reload media, seek, resume a paused clip, mute it or alter ordering.
- Single primary tap on the video toggles overlay visibility, without pausing. Swipes, canceled pointers, multi-touch, long presses and control interactions do not toggle overlays. Native vertical scroll-snap remains the navigation mechanism; full-height videos use object-fit:contain, so landscape and portrait sources are not cropped.
- Hide the normal native video control layer only while immersive; existing Play/Pause, Mute, speed, Ordered/Shuffle/Reshuffle, Details, Previous/Next and recovery actions remain overlays. Add a labelled seek slider/time display for immersive scrubbing. Scrubbing and controls must not navigate reels or hide overlays.
- Keep a small Exit full screen button visible and keyboard accessible even with other overlays hidden. Hidden controls must not remain focusable or screen-reader exposed. Tab/focus restores visible controls; Escape works from any control. Overlay state survives swipes. Error/retry states reveal controls so recovery is discoverable.
- Place overlays inside safe areas with >=44px targets; compact short landscape layout and no horizontal/body scrolling. Background gradients provide contrast. Orientation/viewport changes recenter without losing the current item or pause intent. Respect reduced motion and do not prevent browser zoom.
- Fullscreen and overlay state are page-local presentation, not saved playback/session data. A Details round trip continues the existing paused restoration behavior and can reopen Full screen explicitly.

## Acceptance
1. Existing normal Reels tests and duplicate/thumbnail tests remain passing.
2. Entry/exit preserves source, currentTime, paused state, mute, speed, current item, shuffle seed and playlist.
3. Container fullscreen succeeds where supported; denial, unavailable API, repeated entry/exit and late resolution are safe.
4. Tap hides/restores controls; touch swipe and wheel still navigate with one live source; control/range gestures never toggle overlays or navigate.
5. Escape/browser exit restores layout and focus; Tab reveals overlays and reaches visible controls, hidden controls cannot trap focus.
6. 320x700, 390x844, 844x390 and desktop layouts fill available viewport, preserve aspect ratio, and retain accessible Exit/recovery.
7. No new POSTs or product mutations. CI inspected before push; no deploy workflow invoked.
8. Native iOS/Android browser-chrome behavior, physical gestures, sound carry-over and assistive technology remain explicitly unverified until device acceptance.

## Platform evidence
Context7 `/mdn/content`, retrieved 2026-11-06:
- https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen — user-gesture request, promise and fullscreenchange/error.
- https://developer.mozilla.org/en-US/docs/Web/API/Document/fullscreenchange_event — inspect fullscreenElement to reconcile browser exit.
- https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action — browser scrolling generates pointercancel; preserve browser panning/zoom.
- https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event — canceled scrolling gestures cannot be treated as taps.
