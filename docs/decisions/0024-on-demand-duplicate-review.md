# 0024. Review single-video duplicates using on-demand R2 MD5
Date: 2026-11-06 | Status: DECIDED | Supersedes: — | Evidence: [investigation](../research/2026-11-06-duplicate-video-review.md), [approved spec](../superpowers/specs/2026-11-06-duplicate-video-review-design.md)

## Context
Post-based keys prevent repeated downloads of one post but not repeated content across posts. The owner wants a small manual cleanup page. Existing post deletion removes all attachments, while D1 stores aggregate post bytes. A checksum index or per-attachment storage model would expand the change.

## Decision
Select equal-size eligible single-video entries in D1 and verify their explicit R2 MD5 and actual size in bounded on-demand reads. Present complete groups with explicit keeper/removal selection. Revalidate live rows, expected fingerprints and absence of sibling objects before each single-victim deletion, then reuse existing deletion/tombstone/accounting behavior. Add no migration, dependency, automatic deduplication or download-path changes. Missing checksum or ambiguous state disables cleanup. Preserve and disclose existing non-atomic deletion limitations.

## Consequences
- easier: reuses stored metadata, playback and storage semantics; no video-body hashing or persistent scan state.
- harder: D1 size drift can hide matches; re-encodes, multi-video posts and orphans are outside coverage; no atomic last-copy guarantee across clients/cron.
- revisit when: excluded entries or re-encodes materially limit savings, scans become slow, or coordinated deletion/undo is required.
