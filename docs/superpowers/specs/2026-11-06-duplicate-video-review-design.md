# Library duplicate video review
Date: 2026-11-06 | Status: PROPOSED

## Goal

The owner can open a Duplicates page from the Library, scroll through groups of matching
video files, play each copy, select a keeper, and permanently remove selected redundant
entries to reclaim storage. Detection uses existing metadata and does not fetch video bodies.

This spec formalizes the Opus 5.5 / GPT-6.1-Sol committee recommendation. The owner requested
the spec on 2026-11-06; implementation and deployment have not been approved.

## Evidence and constraints

[Investigation and sources](../../research/2026-11-06-duplicate-video-review.md) record the
code inspection, Cloudflare documentation, committee conclusions, and read-only production
checks. That snapshot found six matching-size/ETag pairs with approximately 773 MB of
potential savings. It did **not** verify the production Workers `checksums.md5` field.

The existing app stores one D1 row per post. Single-video keys are `<postId>.mp4`; multi-video
keys have attachment suffixes. D1 `bytes` can sum several attachments, and existing deletion
removes all video objects and the poster for a post before tombstoning its row. These facts
make single-video-only cleanup the smallest safe scope. See ADR-0003, ADR-0007, and
[ADR-0011](../../decisions/0011-tombstone-beats-ledger-library-metadata-in-d1.md).

## Scope

Include exact-file candidate review for live, successfully downloaded single-video entries,
manual selection, guarded deletion, and visible scan coverage. Reuse the existing Worker,
D1 schema, R2 objects, authentication, rendering styles, posters, and streaming routes.

No new dependency, migration, fingerprint table, background job, download-path change, or
external processing service. Do not add perceptual matching, filename similarity, automatic
deletion, download-time deduplication, shared objects, metadata merging, undo, orphan cleanup,
or individual attachment deletion. Multi-video entries are counted as excluded, not offered
as actionable groups. Byte-identical reposts can match; re-encoded or cropped copies may not.

## Page and interaction

- `GET /duplicates` renders an owner-only page. Add **Duplicates** to the Library's owner
  navigation after Queue, including its compact/mobile navigation. Do not run scans or add
  a duplicate-count query when rendering other pages.
- Use the existing page shell and static icon vocabulary. Include a Library return link,
  a brief explanation of exact-file matching, and **Scan for duplicates**. Opening the page
  alone does not start a scan; a scan can inspect the whole eligible library independently
  of the Library's active search, tags, favourites, or pagination.
- Show eligible entries, size-match candidates, candidates checked, verified groups,
  unverified candidates, exclusions, and scan start/completion times. Do not describe all
  eligible rows as checksum-checked when only size-match candidates were checked.
- Scan one bounded batch at a time. Offer Pause/Continue and Rescan; pause takes effect after
  the current request. Rescan clears results and selection. Reloading or leaving the page
  discards the in-memory scan; continuation across page reloads is not required.
- Each complete group contains matching copies in first-seen order, then post-ID order.
  Show poster, title or post text, source-post link, posted/first-seen dates, duration, file
  size, favourite, tags, and description when present. Use the actual verified object size.
  Play through `/v/:key`, with `preload="none"`; posters use `/p/:postId`. Never autoplay.
- Each group has a labelled keeper radio control and independent removal checkboxes. Neither
  keeper nor removals are selected initially. The keeper cannot also be selected for removal;
  choosing a different keeper clears that copy's removal checkbox. Additional unselected
  copies may remain. There is no cross-group delete-all action.
- **Delete selected copies** is enabled only after choosing a keeper and at least one victim.
  Confirmation names the selected entries, count, estimated video bytes, and the permanent
  effect. Explain that titles/descriptions/tags/favourites/resume state on deleted entries
  remain hidden with their tombstoned rows and are not copied to the keeper. One confirmation
  includes this information; no additional confirmation cascade.
- All controls work with keyboard navigation and visible focus; label each preview and
  selection control. Announce progress and outcomes without stealing focus. At 390 px and
  320 px, cards stack and controls remain usable without horizontal page scrolling.

Empty/error states distinguish: not scanned; no eligible entries; no equal-size candidates;
completed with no checksum matches; partial scan; individual objects unverifiable; request
failure. Never say the entire library has no duplicates: coverage is limited to eligible
single-video entries and the D1 size prefilter.

## Candidate selection and checksum rules

An eligible row has `status='downloaded'`, `deleted_at IS NULL`, `error IS NULL`, a positive
integer `bytes`, and `r2_key = post_id || '.mp4'`. Select rows belonging to size groups with
more than one eligible row. Do not reuse `listLibrary()` limits or assume an 800-row library
ceiling. Count exclusions separately from unique-size eligible rows that need no HEAD request.

For each candidate, read R2 metadata using `head(r2_key)`:

1. Missing object, missing/invalid MD5, or an R2 read error yields an unverified result, never
   a match. Do not group absent checksums together. Preserve a safe reason for the UI.
2. If the R2 size differs from D1 `bytes`, mark the entry stale/unverified and exclude it from
   matching. Do not repair D1 as a side effect of scanning.
3. Match the actual positive object size plus the explicit 16-byte `checksums.md5`, normalized
   to lowercase hexadecimal. Do not substitute ETag, filename, duration, or post text.
4. A matching subgroup needs at least two verified rows. Equal-size rows with different MD5s
   form different subgroups or singletons. MD5 is a practical signal for this personal library,
   not a collision-proof adversarial identity check; manual review remains required.

Missing checksum coverage is visible and disables deletion for those entries. This fails
closed even if live Workers MD5 availability differs from the documented behavior.

## Scan API and bounded continuation

`GET /api/duplicates/scan` accepts an optional cursor containing the last consumed D1 size
and post ID. Validate a positive safe-integer size and `POST_ID_RE` ID, require both fields
together, and use bound SQL parameters. Order by `bytes ASC, post_id ASC` consistently.
Compute equal-size candidate membership (`COUNT(*) > 1`) over the full eligible set **before**
applying the cursor. Otherwise the final remaining row of a bucket could disappear on
continuation and leave that bucket incomplete.

- Read at most **100 candidates** plus one lookahead row per request. Perform at most 100
  metadata HEADs, with at most **4 in flight**. These are named constants, not caller options.
- Return candidate results (display metadata, verified size/MD5 or safe failure reason),
  coverage counts, timestamp, the last-consumed cursor or `null` when exhausted, and whether
  the final size bucket is complete according to lookahead. Lookahead is not consumed.
- The browser accumulates unfinished size buckets in memory and combines results across
  batches. Publish actionable checksum groups only when their size bucket is complete.
  A bucket larger than 100 must continue, not be discarded or split into separate keeper
  decisions. Individual unverifiable members remain visible as omissions from that bucket.
- Continue from the last successful cursor after a request-level error; deduplicate accumulated
  rows by post ID. Advance past per-object failures while showing them as unverified; Rescan
  retries them. Never loop silently on a failing request.
- Candidate queries and counts are observations, not a transaction spanning requests. New
  downloads or other edits can change coverage during a scan. Show this limitation and offer
  Rescan; deletion must revalidate independently. Stale D1 sizes can conceal candidates even
  when all returned rows were verified.

The server stores no scan sessions in KV/D1, trusts no browser result as deletion authority,
and fetches no X metadata. HTML/API responses use `Cache-Control: private, no-store`.

## Guarded deletion

`POST /api/duplicates/resolve` accepts JSON for **one victim**:

```json
{
  "keep": "<postId>",
  "remove": "<different postId>",
  "expected": { "bytes": 123456, "md5": "<32 lowercase hex characters>" }
}
```

The owner may select multiple victims in the page; after confirmation, the browser sends
these requests sequentially, retaining the same keeper. Disable page mutation controls
during that sequence. Single-victim requests bound work and avoid implying an atomic batch.

Before any deletion, the server:

1. Validates JSON, identifiers, distinct keeper/victim, positive safe-integer byte count,
   and MD5 format. Reject other content types using the existing JSON-only CSRF convention.
2. Reloads both D1 rows and requires eligibility. Reads both R2 objects' metadata and requires
   valid MD5/size equality with each other **and** the submitted expected fingerprint. Client
   IDs, keys, hashes, coverage, and keeper choices are never sufficient by themselves.
3. Checks `<id>-1.mp4` through `<id>-4.mp4` for both posts. Any sibling object or failed check
   rejects cleanup; post deletion must not remove a unique hidden companion video.
4. Reuses the existing R2 deletion → D1 tombstone → storage-counter adjustment sequence,
   extracted into a shared helper used by the existing DELETE route. Preserve that route's
   behavior and repeat-delete semantics. Derive all deletion keys on the server.

Return 204 after the full sequence succeeds. Invalid input returns 400, wrong content type
415, wrong method 405, and failed eligibility/fingerprint/sibling validation 409 with a safe
reason; these validation failures occur before writes. Authentication failures follow the
existing Access gate; viewers receive 403 for the page and both APIs. Infrastructure failure
returns a server error, never a fabricated success.

After each 204, remove that victim from the displayed group and add its verified video bytes
to the session's estimated reclaimed amount. Remove the group when only one verified copy
remains. Poster bytes are not included. If a request fails or its response is lost, stop the
sequence, keep acknowledged successes, clear remaining selections, and request a rescan.
Do not automatically retry deletion or claim a failed request changed nothing: R2 deletion
may have succeeded before a later step failed. A rescan establishes visible state; existing
repeat-DELETE cleanup remains an operational recovery path for partial deletion failures.

## Consistency and explicit limits

Keep per-post tombstones so normal later sync skips intentionally removed posts. Preserve
existing sequential once-only storage accounting; this feature does not promise exact
accounting under concurrent requests or a failed counter write.

Fresh validation narrows stale-page risk but does not make D1/R2 operations atomic. A separate
tab can remove a keeper after validation. An already-running cron can race the existing
delete/tombstone sequence. The UI's single-flight behavior prevents its own overlapping
actions, not other clients or cron. Do not claim an unconditional last-copy guarantee, a
transactional batch, or guaranteed permanent absence during these races. Coordinating all
deletion and sync paths would require a separate, larger design.

## Verification and acceptance

Before enabling real cleanup, perform a read-only metadata check through an authenticated
Workers R2 binding on representative existing objects, including a matching-ETag pair and an
equal-size/different-ETag pair from the investigation if still present. Verify explicit MD5
availability and grouping; do not weaken the algorithm to ETag if unavailable. Record results
in shared project docs. Production test deletions require specifically authorized disposable
objects or owner-selected victims; this spec authorizes none.

Use the existing `node --test` setup and FakeR2 with realistic checksum metadata. Acceptance:

1. Equal actual sizes and MD5s group; equal sizes/different hashes do not. Null hashes,
   missing objects, malformed checksums, stale sizes, and failed reads cannot enable cleanup.
2. Single-video eligibility and every exclusion are tested, including tombstones and partial
   downloads. A hidden sibling blocks deletion even when D1 describes a single-video entry.
3. More than 100 candidates, a single size bucket exceeding 100, same-size/different-hash
   subgroups, and a library exceeding 800 entries are handled without silent truncation.
   Include a continuation whose bucket has only one unconsumed row, proving candidate
   membership is computed before the cursor. Pause, failed-request continuation, and Rescan
   preserve or reset state as specified.
4. The owner can preview, choose one keeper, select victims, confirm, and see incremental
   outcomes. No selection is automatic; the keeper cannot be a victim. Metadata-loss and
   coverage information are visible. Empty, incomplete, unverifiable, and error states differ.
5. Non-owner requests are denied before duplicate data/R2 reads. Inputs, method/content-type
   checks, escaping, private responses, and fingerprint tampering are covered.
6. A vanished/tombstoned/changed keeper or victim, unexpected siblings, and changed expected
   hashes return 409 without deletion. Sequential retries and existing DELETE behavior retain
   tombstone/accounting semantics. Inject failures between mutation stages and lost responses;
   the UI stops and does not report unacknowledged deletion as success.
7. Existing Library, Watch, Queue, Stats, streaming, tag editing, and sync tests still pass.
   Run `npm run check`, inspect desktop and narrow/mobile UI interactions, and verify that
   detection reads metadata only and video bodies load only on playback.

## Change surface and approval

Expected changes: `src/store.ts` for eligible candidates/counts, `src/index.ts` for routes and
shared deletion, `src/html.ts` for page/navigation, `src/limits.ts` for bounds, `test/fakes.ts`
and focused Store/route/UI coverage. A focused `src/duplicates.ts` may hold checksum/scan logic
if it keeps the existing large modules readable; use absolute imports. No unrelated refactor.

On owner approval, record an ADR for this matching/cleanup boundary and write an implementation
plan with TDD and the read-only production checksum verification step. Keep this document
PROPOSED until approval; the deferred approval is tracked in [QUESTIONS](../../QUESTIONS.md).
