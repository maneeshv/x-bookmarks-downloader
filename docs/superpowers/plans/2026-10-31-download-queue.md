# Download queue page and save-first backfill — implementation plan

Spec: `../specs/2026-10-31-download-queue-design.md` (APPROVED 2026-10-31)
Decision: ADR-0023 (written in step 1)

TDD throughout: every step adds its failing test first, then the code.

## 1. Record the decision

- [x] Write `docs/decisions/0023-backfill-records-before-downloading.md`: context (the 2026-10-31
      canceled request lost unrecorded bookmarks), decision (backfill = insert-only record
      phase, then budgeted download; the cron is unchanged), and revisit-when (a backlog the
      cron can't drain in a day, which would justify Queues/Workflows under a new ADR).

## 2. Insert-only store write and queue reads (`src/store.ts`, `test/store.test.ts`)

- [x] `recordSeen(r: BookmarkUpsert): Promise<boolean>`: `INSERT … ON CONFLICT(post_id) DO
      NOTHING`; returns whether a row was inserted (`meta.changes`).
- [x] Tests: new row → pending and `true`. Existing downloaded, failed (keeps `error`/`bytes`),
      pending (keeps `updated_at`), or tombstoned row → unchanged and `false`.
- [x] `listQueue(limit = 500)`: `{ pending, failed }` with live rows only. Pending ordered
      `updated_at ASC, post_id ASC`; failed ordered `updated_at DESC, post_id DESC`.
- [x] `countQueue()`: live pending + failed count.
- [x] Test: pending order equals `listPendingIds()` order; deleted rows excluded.

## 3. Save-first backfill (`src/sync.ts`, `test/sync.test.ts`)

- [x] Failing test: a 3-page backfill whose first `video.twimg.com` fetch records how many D1
      rows exist when it is called. Every video bookmark from all pages must already be a row.
- [x] Failing test: backfill over a page of already-downloaded items makes no R2 `head` and no
      `pbs.twimg.com` fetch for them.
- [x] Failing test: backfill leaves a `failed` row's status/error untouched (no reset to
      pending), and the JSON has `recorded` and `queued`.
- [x] Implement: in the backfill branch, collect page items while recording them (`no_video`
      upsert or `recordSeen`). Then run the pending lookup, then `processItem` for collected
      items whose row is `pending` and not hydrated. Leave the cron branch as is.
- [x] Add `recorded`/`queued` to `SyncResult`; set `queued` from `countQueue()` pending.
- [x] Existing sync tests (cap → pending, hydration, breaker, partial multi-video) still pass
      unmodified.

## 4. Queue page (`src/html.ts`, `src/index.ts`, `test/index.test.ts`)

- [x] Failing tests: `/queue` is owner-only (add it to the three path lists). The owner sees
      pending rows in drain order with position and ≈time, and failed rows with Retry and
      Retry-all. Paused / needs_reauth → stalled banner and no ETA. Empty → empty state.
- [x] Pure helper `nextTick(nowMs)` (next `:00`/`:30` UTC) and the per-position ETA, unit
      tested at the :29:59 / :30:00 / :59:59 boundaries.
- [x] `renderQueue(queue, status, pausedUntil, now)`. Reuse the stats table markup/CSS and the
      existing retry script (the retry script moved with the tables, so only the Queue page uses it).
- [x] Route `GET /queue` in `src/index.ts` next to `/stats`.

## 5. Navigation and Stats (`src/html.ts`, tests)

- [x] Failing tests: the Library rail shows a "Queue" link (with count when > 0) to the owner
      only. `/stats` links to `/queue`, has no Pending/Failed tables, and "Run backfill"
      points to `/backfill`.
- [x] Add the Feather `clock` icon path to the static icon map (ADR-0021).
- [x] The index route passes `countQueue()` for the owner only.
- [x] Remove the two tables from `renderStats()`; `index.ts` no longer calls
      `listByStatus(["pending","failed"])` for `/stats`.

## 6. Verify and document

- [x] `npm run check` passes both typechecks and all tests.
- [x] Browser QA with synthetic fixtures (desktop 1487 px, mobile 390 px via iframes): Queue with
      pending + failed, the empty state, the paused and re-auth banners, the rail link, and Retry all.
- [x] Rewrite the `docs/ARCHITECTURE.md` route list and sync steps; update the
      `docs/runbooks/deploy.md` step 9 and `docs/runbooks/reset-store.md` drain steps (no
      more repeated `?downloads=30`).
- [ ] Delete the GOTCHAS "unrecorded bookmarks on a canceled backfill" line once this is
      deployed (the step 3 test encodes it; production still runs the old order until then).
- [ ] After deploy (owner-authorized): run `/backfill` once, confirm `recorded` and
      `queued`, and check the Queue page. This also recovers any bookmarks the canceled
      2026-10-31 runs never recorded.
