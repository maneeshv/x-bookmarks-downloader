# 0027. Container fullscreen with an immersive viewport fallback
Date: 2026-11-06 | Status: DECIDED | Supersedes: ADR-0026 native controls only within optional immersive mode | Evidence: [approved addendum](../superpowers/specs/2026-11-06-reels-immersive-design.md)

## Context
The owner finds the surrounding Reels controls reduce the swipe/video surface. Native video-only fullscreen would remove our swipe navigation and overlays; mobile browsers do not consistently support container fullscreen.

## Decision
Keep the current layout as default and add explicit Full screen mode using the same video and session. Fill the viewport immediately, and attempt fullscreen on the Reels container as an enhancement. Overlay controls can be hidden/restored by a video tap; a small Exit control remains visible. Use accessible existing playback controls plus a labelled seek slider in immersive mode, restoring native video controls on exit. Preserve native vertical snap scrolling and reject swipe/cancel/control events as taps. Do not crop videos. Presentation changes must not reload or resume media.

## Consequences
- Easier: one playback/session lifecycle; no dependency, server route or migration.
- Harder: custom immersive seek/focus and fullscreen rejection/exit races need behavioral and browser checks.
- Limit: mobile browser chrome may remain, and physical iOS/Android/assistive-technology acceptance is still required.
- Revisit when: real-device tests reveal gesture interference or unusable safe areas.
- Delivery: commit/push PR40 only; no deployment or merge authorized for this increment.
