# 0023. Backfill records every bookmark before downloading
Date: 2026-10-31 | Status: DECIDED (owner chose "save all first, then cron") | Evidence: docs/superpowers/specs/2026-10-31-download-queue-design.md

## Context
`/backfill` ran inside the owner's browser request. It wrote each bookmark row only when `processItem()` reached it, after that item's downloads. On 2026-10-31 a `/backfill?downloads=30` request stopped after 22 rows, before its final status write. Cloudflare may cancel an HTTP Worker's work once the client disconnects (https://developers.cloudflare.com/workers/platform/limits/, Duration). Every bookmark after the cut-off was never recorded, not even as `pending`, so it was invisible to `/stats` and to the cron's pending lookup.

## Decision
A backfill has two phases. **Record:** read every bookmark page and insert each video post with `Store.recordSeen()` (`INSERT … ON CONFLICT DO NOTHING`; existing rows, including failed and tombstoned ones, are untouched). Posts without video are upserted as `no_video`. **Download:** run the normal pending lookup, then `processItem()` for this run's page items whose row is still `pending`. Already-downloaded page items are skipped. The download budget is unchanged (default 5, `?downloads=N` ≤ 30); the 30-minute cron drains the rest. The cron path is unchanged. Not chosen: Cloudflare Queues/Workflows (new dependency, unneeded at ≤800 bookmarks) and `waitUntil()` (capped at 30 s after disconnect).

## Consequences
- A canceled backfill can only stop downloads early; it cannot lose a bookmark it has read.
- Insert-only recording keeps a `failed` row failed (it is not silently retried) and keeps pending rows in the cron's drain order.
- A backfill no longer re-checks R2 or posters for already-downloaded rows; the cron's newest-20 page still reconciles those, and `/backfill?posters=N` (ADR-0018) migrates posters.
- Revisit when: the backlog regularly takes more than a day for the cron to drain, which would justify Queues under a new ADR (see ADR-0008).
