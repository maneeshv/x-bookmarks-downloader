# Identical thumbnail suggestions — verification

Date: 2026-11-06. Scope: ADR-0025, review-only suggestions on `/duplicates`.

## Automated and independent review
`npm run check` passed both TypeScript projects, 132 tests, and the session gate. New checks cover equal posters with differing video size/duration; same size/different checksum; absent/SVG/unsupported posters; malformed/missing checksums; per-object and database failures; 803-row pagination with at most 100 HEADs and four concurrent calls; 105-member cross-page groups and retry deduplication; private owner-only routing; read-only cards; unchanged exact deletion rejection. Serialized/bundled browser scripts execute in regression tests.

Independent review identified playback being interrupted when thumbnail cards were recreated between batches. Existing video nodes are retained; a regression first failed, then passed. Follow-up review reported no functional findings. `src/duplicates.ts` is unchanged by this increment.

## Native browser interaction
Real production rendering/handler with synthetic owner JWT and local fake storage at `127.0.0.1:4399`, controlled through native Arc. No production media used.

- Desktop: manually ran the exact scan (two groups with explicit keeper/removal controls), then thumbnail scan (one group of six). Inspected separate section labels, warnings, three-column layout, video sizes/durations, original-post and Watch links. Suggestions have no keeper/removal/deletion controls.
- Mobile: 390px iframe, single-column layout; manually scanned six entries into one group. Inspected wrapped text/actions and different durations (0:02/0:09) and sizes. Explicit Play changed the first preview to playing with a pause control and enabled scrubber. Watch link opened the corresponding Watch page.
- The local request log shows only scan GETs from suggestions, and no duplicate-resolve request. Watch navigation invoked its existing resume-saving POST on the synthetic fixture; that is separate from suggestion scanning. Backend tests prove scanning makes no body reads; UI test checks `preload="none"`.
- Large-group continuation, failures/retry and preserved preview node identity are exercised by controlled script tests, not claimed as native-browser interactions.

## Read-only production evidence
A bounded remote-binding probe ran the actual scanner against private D1/R2: 391 eligible rows checked in four pages, 391 usable poster MD5s, zero unverified, four groups of two. Two pairs have different video sizes or durations. This is a point-in-time metadata result, not proof the videos are duplicates or a storage-savings estimate. No video bodies downloaded, data written or media deleted.

## Limits
Only error-free single-video entries are eligible. Encodings with different poster bytes are missed. Shared covers/intros can match unrelated videos. Results are non-transactional and session-local. After this deployment, opening the production test URL in native Arc reached Cloudflare Sign in; signed-in owner UI validation remains outstanding.

## Release evidence
Implementation `3699ff1`, PR #39 open. Worker `2002eed9-d2db-4ac7-98d5-530f44514131` deployed 2026-11-06T11:03:49Z at 100% traffic. Fetched live `index.js` exactly equals the tested dry-run bundle. Vars match; xrender.uk and the 30-minute cron retained. Signed-out curl GET page/API returned 302 to Access and workers.dev returned 404. Implementation CI run 42207353501 passed. Rollback is `4b83031c-6e62-43b9-b17f-47c13f388ce8`. The production metadata scan above used the real scanner with remote bindings; it is not an authenticated call to the deployed endpoint.
