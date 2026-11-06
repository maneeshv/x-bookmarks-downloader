# 0024. Reels as an additive, read-only browsing session
Date: 2026-11-06 | Status: DECIDED | Supersedes: — | Evidence: [spec](../superpowers/specs/2026-11-06-reels-view-design.md), [committee](../research/2026-11-06-reels-feasibility.md)

## Context
The owner approved an independent Reels view and its previews, then authorized implementation,
verification and a PR without deployment. Reels must traverse the selected Library results within
one page, preserve existing Library/Watch behavior and return from Details without losing its place.
The real archive grows beyond X's retrieval window, so an unbounded client feed is inappropriate.

## Decision
Add GET `/reels` to the existing Access-verified viewer allowlist (an explicit addition to ADR-0019,
not a wider admission policy). Embed a complete bounded projection of eligible Library results:
1,000 items and 512 KiB escaped JSON, with an explicit capacity state instead of silent truncation.
Use native browser controls and a small dedicated controller with one active media source, adjacent
posters, vertical snap navigation, stable seeded shuffle and validated versioned tab-session state.
Stay framework-free under ADR-0006; no dependency, schema change, new media service or feed API.
Use one existing indexed playable file per post, the same as Library/Watch. Loop current videos and
advance manually. New sessions start muted with playback-policy fallbacks.

Keep Reels progress separate from Watch's owner `resume_ms` contract (ADR-0022). Reels never reads
or writes that field. Add only Reels-origin return/delete/unavailable navigation to Watch. Rebuild
all URLs from validated context, preserving ADR-0016's prohibition on arbitrary return URLs.
Preserve native control and keyboard behavior, respect explicit pause and backgrounding, and treat
sessionStorage as untrusted display state, never authorization.

## Consequences
- easier: unchanged media/auth paths and Library filtering; no framework or deployment migration.
- harder: exact restoration needs surviving session storage; changing archive membership can alter
  a seeded fallback; phone autoplay/native-control interactions still require real-device validation.
- evidence: read-only 2026-11-06 sizing found 397 eligible items and approximately 66,955 projected
  JSON bytes, below both caps. See implementation QA for final serializer/synthetic checks.
- release boundary: owner authorized building a PR before phone verification; actual iOS Safari and
  Android Chrome testing remains a release gate. No deployment is authorized in this task.
- revisit when: ordinary selections exceed bounds, indexed sibling attachments become required,
  or device validation disproves the proposed snap/player interaction.

## Build constraint

Wrangler defaults to esbuild name preservation, which injects a Worker-scoped `__name` helper
inside functions. Serializing those functions for the browser then fails with `__name is not defined`.
Set `keep_names = false` in Wrangler configuration so the tested factories remain self-contained;
error stack names may be less descriptive. `npm run check:bundle` builds without uploading and
executes the emitted factories in an isolated VM. CI runs it in addition to TypeScript/unit checks.
No production configuration is changed until a separately authorized deployment.
