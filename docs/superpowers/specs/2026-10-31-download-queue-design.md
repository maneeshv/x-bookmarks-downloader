# Download queue page and save-first backfill
Date: 2026-10-31 | Status: APPROVED (owner: "Approved", 2026-10-31)

## Goal

1. The owner can see, in one page next to Stats, every bookmark that has been captured but
   not yet downloaded (pending) or that cannot download (failed), in the order the cron will
   drain it, with an approximate download time.
2. `/backfill` never loses captured bookmarks when its browser request times out.

Owner choices (2026-10-31): a new Queue page (not a `/stats` anchor or Stats sub-tab);
pending **and** failed; fix the timeout by recording every bookmark first, downloading only a
few in the request, and leaving the rest to the cron.

## Evidence (production, read-only, 2026-10-31)

- D1: 256 downloaded, 56 `no_video`, 3 deleted, **0 pending, 0 failed**. The owner expected
  about 100 videos to backfill.
- The `/backfill` at 2026-10-31T06:35Z updated 22 rows about 1 s apart, then stopped. Its final
  `patchStatus` never ran: KV `status.lastRun` is still the 06:30 cron run (`seen 20, pages 1`).
- Cloudflare: HTTP Workers have no wall-clock limit "while the client remains connected"; "when
  the client disconnects … tasks associated with that request may be canceled"
  (https://developers.cloudflare.com/workers/platform/limits/, Duration). JOURNAL 2026-08-30
  measured 30 downloads at ~100 MB taking 6–20 min. Today's files are up to 939 MB.
- Root cause in `src/sync.ts` `sync()`: each bookmark row is written only when `processItem()`
  reaches it, after that item's downloads. A request canceled mid-download leaves every later
  bookmark unrecorded — not even `pending` — so it is invisible to `/stats`, to this Queue page,
  and to the cron's pending lookup. It is recovered only if a later run sees it again on a
  bookmarks page (the cron reads just the newest 20).

## Design

### A. Save-first backfill (`sync(d, { backfill: true })`)

Split the backfill run into two phases. The cron path (`backfill` unset) is unchanged.

1. **Record.** Fetch all bookmark pages exactly as today (≤ `BACKFILL_MAX_REQUESTS` pages of
   `BACKFILL_PAGE_SIZE`, stop at no `next_token` or `BACKFILL_MAX_ITEMS`). For each item:
   no video media → existing `no_video` upsert; video media → new
   `Store.recordSeen(row(it, "pending", d))`, an **insert-only** write
   (`INSERT … ON CONFLICT(post_id) DO NOTHING`). Insert-only is required: the existing
   `UPSERT` would reset a `failed` row to `pending` and refresh `updated_at` on every row, which
   would reorder the queue. Existing rows — downloaded, failed, pending, or tombstoned
   (`deleted_at`) — are untouched.
2. **Download.** Then run the existing pending lookup (`listPendingIds` → `fetchTweetsByIds` →
   `processItem`), followed by `processItem` only for page items whose row is `pending` and
   was not already hydrated. Already-downloaded page items are **skipped** in a backfill: the
   06:35 run spent ~1 s on each one (R2 `head` + poster capture) before reaching new work.
   Poster migration keeps its own route (`/backfill?posters=N`, ADR-0018).
3. **Budget.** Unchanged: default `MAX_DOWNLOADS_PER_RUN` (5), `?downloads=N` clamped to
   `BACKFILL_MAX_DOWNLOADS` (30). A timeout now only stops downloads early; everything seen is
   already queued and the cron drains it (5 per `*/30` tick).
4. **Result.** `SyncResult` gains `recorded` (new rows inserted in phase 1) and `queued` (live
   pending count after the run), so the JSON response shows what was captured.
5. **Stats link.** `/stats` "Run backfill" changes from `/backfill?downloads=30` to `/backfill`.

API cost is unchanged: phase 1 makes the same page reads, and phase 2 uses the same single
pending lookup.

### B. Queue page (`GET /queue`, owner-only)

- **Access:** `/queue` is not a viewer path, so the existing gate (`src/index.ts`) already
  returns 403 to viewers. Add it to the owner-only path lists in `test/index.test.ts`.
- **Data:** a new `Store.listQueue()` returns live (`deleted_at IS NULL`) pending rows in the
  cron's drain order (`updated_at ASC, post_id ASC`, the same as `listPendingIds`), plus failed
  rows (`updated_at DESC`). Use the same 500-row ceiling as `listByStatus` (X returns ≤800
  bookmarks).
- **Summary:** pending and failed counts; the next cron tick (the next `:00`/`:30` UTC); and an
  estimated drain time of `ceil(pending / MAX_DOWNLOADS_PER_RUN)` ticks. If `pausedUntil > now`
  or `auth = needs_reauth`, show a banner that the queue is stalled and why (with the
  Re-authorize link), and no ETA.
- **Pending table:** position, post snippet linking to X (`post_url`), first seen, last
  attempt (`updated_at`), transient error if any (`http_5xx`, `exception`), and an approximate
  time (`nextTick + (ceil(position/5) − 1) × 30 min`, labelled "≈"). No posters: posters are
  captured only after a video is stored, and the app does not hotlink X CDN images (ADR-0018).
- **Failed table:** snippet, error, size (`bytes`), per-row Retry, and "Retry all failed (n)".
  This reuses the existing `/api/videos/:id/retry` and `/api/videos/retry-all` endpoints and
  script unchanged.
- **Stats:** the Pending and Failed tables move off `/stats` to the Queue page so they live in
  one place. `/stats` keeps its tiles, file-size limit, health, and failures-by-reason, and
  links to the Queue page.
- **Navigation:** the Library rail gets an owner-only "Queue" link after Stats (a Feather
  `clock` icon, matching ADR-0021's static icons), showing the pending + failed count when it
  is non-zero. The Stats and Queue headers link to each other and to the Library. The count
  is one `COUNT(*)` on the index route, owner-only.
- **Empty state:** "Nothing waiting. Every captured bookmark is downloaded." plus the last
  sync time. This is what production shows today.

## Failure handling

- A backfill canceled at any point after phase 1 has already recorded every bookmark it read.
  Canceled during phase 1, it keeps all rows written so far (inserts are per-item, not one
  transaction at the end).
- `recordSeen` on an existing row is a no-op. Retry semantics, tombstones, and the
  downloaded-row protection are unchanged.
- The ETA ignores multi-video posts (one post can use several downloads) and new bookmarks
  that the cron's newest-20 page adds ahead of the queue. It is therefore labelled
  approximate, not exact.

## Acceptance criteria

1. A backfill whose first video download never completes still leaves every video bookmark it
   read as a `pending` row (test: assert D1 row count when the first mp4 fetch starts).
2. Backfill phase 1 does not change existing downloaded, failed, pending, or deleted rows.
3. A backfill makes no R2 `head` or poster fetch for page items already downloaded.
4. `/backfill` JSON includes `recorded` and `queued`. The cron path's API-call count and all
   existing sync tests are unchanged.
5. `/queue` returns 200 to the owner and 403 to viewers. It lists pending rows in drain order
   with position and ≈time, and failed rows with working Retry / Retry-all. It shows a
   stalled banner when paused or needing re-auth, and the empty state when nothing is queued.
6. `/stats` links to the Queue page, no longer renders the Pending/Failed tables, and its
   "Run backfill" link is `/backfill`.
7. The Library rail shows "Queue" (with count when non-zero) to the owner only.
8. `npm run check` (both typechecks, all tests) and `scripts/check-session.sh` pass.
   Desktop/mobile browser QA uses synthetic fixtures.
