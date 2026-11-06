# Duplicate Video Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add and deploy the approved owner-only duplicate review and manual cleanup page.
**Architecture:** D1 identifies equal-size eligible entries; bounded R2 HEAD reads verify explicit MD5. Browser memory assembles complete groups across batches. The server validates each single-victim deletion independently and shares the existing post-deletion helper.
**Tech Stack:** TypeScript Worker, D1, R2, existing HTML/CSS/plain browser JS, node:test.
**Spec:** [Approved design](../specs/2026-11-06-duplicate-video-review-design.md).

## Global constraints
- Absolute imports; no new dependency, migration, or download-path changes.
- At most 100 candidate HEADs per scan request and 4 in flight; one lookahead row.
- Candidate membership computed before cursor filtering; never split keeper decisions across an unfinished size bucket.
- Exact non-empty 16-byte MD5 plus actual size; no ETag fallback. Unknown/stale objects fail closed.
- Owner-only page/APIs, private no-store, explicit keeper and victims, no automatic deletion.
- Single-victim resolution validates both rows, expected fingerprint, and four possible sibling keys on each post before any write.
- Preserve existing tombstones, deletion ordering, and sequential accounting. Disclose existing cross-request races.
- No test deletion of real user videos. User authorized commit, push, PR, and deploy.

## Interfaces and file ownership

Backend task owns `src/store.ts`, `src/duplicates.ts`, `src/limits.ts`, `src/index.ts`, `test/fakes.ts`, `test/duplicates.test.ts`, `test/duplicates.routes.test.ts`.
UI task owns `src/html.ts`, optional `src/duplicates-ui.ts`, `test/duplicates.ui.test.ts`.
Controller owns docs, integration fixes after agent completion, local QA scaffolding (ignored), live verification and publication. Both workers read the spec and this contract; neither commits or deploys.

`renderDuplicates(): string` is exported from `#src/html` and called for GET `/duplicates`.
GET `/api/duplicates/scan` accepts paired `afterBytes` and `afterPostId` parameters.

```ts
type DuplicateCursor = { bytes: number; postId: string };
type Fingerprint = { bytes: number; md5: string };
type DuplicateItem = { row: BookmarkRow; fingerprint: Fingerprint | null; reason: string | null };
type DuplicateScan = {
  items: DuplicateItem[];
  counts: { eligible: number; candidates: number; excluded: { multiVideo: number; error: number; unknownSize: number; invalidKey: number } };
  checkedAt: string;
  nextCursor: DuplicateCursor | null;
  trailingSizeComplete: boolean;
};
// POST /api/duplicates/resolve body; 204 success, 409 stale/unsafe, 400 invalid, 415 non-JSON.
type DuplicateResolve = { keep: string; remove: string; expected: Fingerprint };
```

Excluded categories partition live downloaded ineligible rows in order: multi-video key, error, invalid/missing key, unknown/invalid size. Counts do not include pending/failed/no-video/tombstoned rows. Candidates is number of rows in equal-size eligible buckets, not bucket count. `row.bytes` defines scan bucket ordering; fingerprint is only populated after size matches it. Reasons are safe machine labels, rendered as friendly copy. API errors return safe JSON `{error: string}`. Backend exports these types from `src/duplicates.ts`.

## Task 1 — Candidate scanning and guarded resolution

- [x] Write failing Store/scan tests with real FakeD1 SQL and FakeR2 MD5: equal hashes group eligibility, different hashes, missing/malformed MD5, missing objects, stale sizes, exclusions, 101+ same-size rows, >800 rows, concurrency cap and request errors. Use `node --no-warnings --test test/duplicates.test.ts` and capture failure before implementation.
- [x] Add candidate/count Store methods. Use a grouped eligible CTE before keyset cursor and LIMIT 101; return 100 rows and lookahead-derived completion. Implement four-worker HEAD processing preserving order and safe per-item failure results.
- [x] Add failing route tests for unauthorized/viewer gates, paired cursor validation, no-store, resolve body/method validation, keeper/victim changes, every sibling, idempotent existing DELETE, and partial mutation failures. Use `node --no-warnings --test test/duplicates.routes.test.ts`.
- [x] Implement scan/resolve routes and shared deletion helper. Minimal resolver flow:
  ```ts
  // Parse and validate before writes; rows and fresh metadata must all match.
  // For both posts, HEAD the unsuffixed video plus suffixes 1..4.
  // If any read or invariant fails, return safe error, never delete.
  await deleteBookmark(store, victim); // R2 -> tombstone -> accounting
  return new Response(null, { status: 204, headers: privateHeaders });
  ```
- [x] Run focused tests and typechecks. Report commands, red/green evidence, files and any deviations. Controller reviews the diff before commit.

## Task 2 — Grouped page and navigation

- [x] Add failing UI tests for owner-only navigation, no initial scan, controls, serialized client script syntax and scan/group/selection state transitions. Use existing fake data; no DOM dependency.
- [x] Add `renderDuplicates` using existing shell/styles and reusable pure browser-state helpers if needed. Fetch the exact contract above. Accumulate by D1 size and post ID, finalize buckets using lookahead, and group only verified fingerprints. Preserve incomplete bucket on Pause/Continue; clear all state on Rescan.
- [x] Render safe DOM text, same-origin preview URLs, metadata, coverage and reason-specific unverified entries. Nothing auto-selected. Send sequential resolve requests after one confirmation; stop on any ambiguous error, retain acknowledged results, clear remaining selections and require rescan.
- [x] Verify keyboard/live-region/focus behavior and 320/390px stacking. Run focused UI tests and typecheck. Controller performs real browser QA and integration checks.

## Task 3 — Integration, production preflight and release

- [x] Record approval and ADR-0024. Read live Worker version/bindings/source; compare the deployed source to the checkout baseline and preserve live-only features. Fetch origin/main and verify ancestry.
- [x] Use Wrangler remote bindings for a read-only MD5 probe on existing objects (no video-body downloads); compare a known matching pair and same-size/different-ETag pair. Record checksum evidence without tokens or secrets. Cleanup cannot launch if MD5 availability is unverified.
- [x] Run `npm run check`; inspect desktop and mobile local UI with synthetic fixtures, including scan, selection, no automatic media download, deletion success/failure and owner/viewer differences. No production deletion test.
- [x] Independent spec/security/quality review of the complete diff; fix actionable findings and rerun affected checks.
- [ ] Update ARCHITECTURE, JOURNAL, STATUS and this checklist. Commit code and docs together with conventional commit subject; push current feature branch, create PR against main using the GitHub tool and relevant validation evidence.
- [ ] Deploy with verified ignored config and preserved owner/access bindings. Verify deployment ID/traffic, custom-domain Access behavior and disabled workers.dev; authenticated read-only browser smoke if available. Record rollback version and owner test URL. Amend release docs and push follow-up commit if needed.

## Execution evidence

- Baseline: 97 tests pass on 2026-11-06 before product changes.
- Claude adapter readiness: unsupported CLI 2.1.291 (missing logs/attach); native subagent UI fallback, no CLI upgrade or permission bypass.

- Integrated verification: `npm run check` passed both TypeScript projects, all 126 tests and session gate. Independent final review found no actionable issues; its duplicate suite passed 29/29.
- Browser QA: real handler with resettable local fakes, desktop and 320/390px iframes; manual scan, no initial media request, explicit selection, two sequential synthetic deletions, playback, empty state and synthetic 503 cleanup failure passed. See [QA report](../../research/2026-11-06-duplicate-review-qa.md).
- Production preflight: 16/16 candidate HEADs exposed MD5, six matching pairs, 772,660,142 potential redundant bytes, zero size drift. Active pre-release version is `92b1c6a8-8095-4373-9d8b-e8f9c0ca7df5` at 100%. Live source matches the committed baseline after normalizing source-path comments and the generated default-export name. Verified all resource bindings/vars; restored missing local OWNER_EMAIL from the live binding. No migration.
