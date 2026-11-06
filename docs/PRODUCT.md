# Product: x-downloader

Updated: 2026-11-06 (Reels implemented in source; deployment tracked in STATUS)

## Problem
The owner bookmarks video posts in the X/Twitter mobile or web app. Those bookmarks are trapped in X: no export, videos can be deleted, and the official API charges for bookmark reads. The owner wants every bookmarked video to land automatically in their own cloud storage without touching anything after bookmarking.

## User
One owner, using their own X account and bookmarks, plus a small exact-email list of trusted read-only
viewers. The project may be open-sourced so others can deploy their own instance. **Multi-tenancy and
viewer-owned data are non-goals.**

## Core flow
1. Owner bookmarks a video post in X (any client).
2. A scheduled job in the cloud notices the new bookmark.
3. The video and its available poster are copied to the owner's private cloud storage, and the job remembers them so they are never downloaded twice.
4. Owner browses a paginated library page (`/`) — search, discoverable multi-tag AND filtering and favourites filters, sort by
   newest/oldest/title/largest/smallest/longest/shortest, and 10/20/30/50 videos per page — and opens a per-video watch page
   (`/watch/:id`) to play the video, set a title/description, choose existing shared tags or create one by pressing Enter, toggle favourite, or delete it. Back to
   library restores the originating query, page, and card position. Library cards and watch pages
   use same-origin, Access-gated posters rather than depending on X's CDN (ADR-0011, ADR-0016,
   ADR-0018, ADR-0020).
5. An exact-email viewer can browse, load posters, watch, and download the complete library but
   cannot reach metadata, delete, retry, settings, status, X OAuth, or backfill capabilities
   (ADR-0019).

6. Reels (`/reels`) offers a separate swipe view over the full selected Library results, in Library
   order or stable Shuffle. One clip plays at a time, loops until manual advance, and starts muted in
   a new session. Details opens Watch; returning restores the surviving reel and tab-local position,
   paused. Reels progress stays separate from owner Watch progress. Oversized selections are clearly
   rejected rather than silently truncated (ADR-0024). Existing Library/Watch workflows remain.

## Constraints (from the owner, 2026-08-29)
- Runs **entirely in the cloud**: scheduling, downloading, storage. No home server, no laptop dependency.
- **Near-zero cost.** Target $0/month on Cloudflare free tiers; storage overage is the accepted, expected expense. Small charges are tolerable; a $100/month X API tier is not.
- Cloudflare stack preferred (owner's belief that it covers scheduling, compute, storage).
- No X API subscription tier. Bookmarks are read through the official API v2 on pay-per-use (≈ $0.70–3.50/month) — ADR-0002. No session-cookie scraping, no headless browser.
- **No human writes code.** An AI agent maintains the repo across sessions; docs are the agent's memory (`CLAUDE.md`, `docs/STANDARDS.md`).
- Open-source-ready: no secrets in the repo, clone-and-deploy instructions, nothing account-specific hardcoded.

## Non-goals
- Multi-tenant / SaaS operation, viewer-owned libraries, or roles beyond one owner and read-only viewers.
- Archiving arbitrary images, threads, or text. The one poster used by each saved video's UI is the
  only image copied (ADR-0018); GIF-as-mp4 remains a video because X serves it as mp4.
- Transcoding, thumbnail generation, or viewer dashboards.
- Bulk actions, undo, un-bookmarking on X. (Search/filter/favourite/title/description/delete shipped 2026-08-30 — spec `2026-08-30-video-library-design.md`, ADR-0011; tagging was added 2026-09-03 — ADR-0020.)
- Automating the X login (username/password/2FA). The owner supplies a session; the tool never logs in.
- Re-hosting or sharing videos publicly.

## Success criteria
- Bookmark a video → it appears in storage within one polling interval, without intervention.
- Saved videos keep a usable library/watch poster even if X later removes the source image.
- Zero duplicates; a crashed run never loses or double-stores a video.
- Monthly bill ≈ $0 on Cloudflare apart from storage beyond the free 10 GB, plus a few dollars at most for X API reads.
- When the X tokens die or X changes its API, the failure is visible (status page / log), and recovery is a documented ≤5-minute runbook (`docs/runbooks/`).
- A fresh agent session can read `CLAUDE.md` + `docs/STATUS.md` and continue work without re-briefing.

## Known risks (accepted by design, tracked in ADRs)
- X API pay-per-use pricing or the Owned-Reads rate can change; the bill is capped by a console spending limit. See `docs/research/2026-08-29-x-api-v2.md`.
- OAuth refresh tokens are single-use and can be invalidated (revoked app, long idle); recovery is `docs/runbooks/refresh-auth.md` (≤2 minutes).
- Only the 800 most recent bookmarks are reachable through the API; older ones are not archived.
- Agent-written code can misbehave; hard caps and a circuit breaker bound the damage — ADR-0005.
