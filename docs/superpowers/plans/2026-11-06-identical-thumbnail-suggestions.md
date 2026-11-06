# Identical thumbnail suggestions implementation plan

Date: 2026-11-06. Owner approved via Sage: “Ok let's proceed with that. I approve.”

**Goal:** Separate review-only identical-thumbnail groups on `/duplicates`.
**Architecture:** Keyset-page live error-free single-video rows by post ID, independently of video size/duration. HEAD stored `posters/<id>` only; browser accumulates matching explicit poster MD5+size across batches. Existing exact-video scan/resolve semantics stay intact.
**Stack:** Existing TypeScript Worker/D1/R2 and browser JS; no dependency or migration.
**Approved scope:** [feasibility](../../research/2026-11-06-thumbnail-match-feasibility.md), exact-poster increment only. Implementation/commit/push/PR/deploy authorized; no production deletion. Inline execution with one writer and independent final review.

## Contract and constraints
- New owner-only `GET /api/duplicates/thumbnails?afterPostId=...`, private/no-store safe JSON errors.
- Store `listThumbnailCandidates(after: string|null)` returns at most 101 rows; `countThumbnailCandidates()` counts eligible rows. Live downloaded, error-free, exact unsuffixed key, independent of video bytes/duration.
- `scanThumbnails(store, after)` returns `{items: {row,poster: {bytes,md5}|null,reason:string|null}[],eligible:number,checkedAt:string,nextCursor:string|null}`. At most 100 HEADs, four concurrent, stable result order. Validate positive safe poster size within existing cap, JPEG/PNG/WebP content type and explicit 16-byte MD5. Missing/invalid/error metadata remains unknown; never use placeholder or ETag as equality evidence.
- Group by poster size+MD5 in page memory; deduplicate retry rows. Partial scan/groups clearly marked; no deletion, keeper controls, or savings claim. Manual scan/pause/continue/rescan; failed batch retries same acknowledged cursor.
- Render video bytes/duration, title/metadata, lazy preview and Watch link. No names/sizes/duration equality filter. Exact cleanup invalidates thumbnail results so deleted entries do not remain presented. Prevent overlapping scans/cleanup in this tab.

## Tasks
- [x] Backend TDD: differing video size/duration with same poster; equal poster size/different hash; missing/invalid/SVG/error metadata; >800 rows, boundaries and HEAD concurrency; owner/cursor validation and no mutation. Add Store query, bounded scanner and route; FakeR2 HEAD includes stored content type.
- [x] UI TDD: cross-page groups/retry dedup, missing metadata exclusion, no suggestion controls/resolve calls, failure retry and progress; add separately labeled section and reuse existing card rendering in review-only mode. Execute bundled script regression.
- [x] Read-only production poster metadata scan and live source/settings/rollback preflight. Verify code includes current main and previous PR state; no real media deletion.
- [x] Full checks and independent review; real desktop/mobile synthetic interaction, exact scan unchanged; fix findings. Update architecture/session docs.
- [ ] Commit/push into current open PR #39, update description to final scope, deploy verified bundle; check live source/traffic/protected routes and record release evidence. Owner-signed-in UI only if authenticated browser is available.

Verification commands: `node --no-warnings --test test/thumbnails.test.ts test/duplicates.routes.test.ts test/duplicates.ui.test.ts`, `npm run check`, `git diff --check`, `scripts/check-session.sh`.
