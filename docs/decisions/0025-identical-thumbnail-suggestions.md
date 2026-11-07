# 0025. Keep identical-thumbnail suggestions separate from video duplicate cleanup
Date: 2026-11-06 | Status: DECIDED | Evidence: [feasibility](../research/2026-11-06-thumbnail-match-feasibility.md)

## Context
Different video encodings or lengths may share a stored poster. The exact-video size prefilter cannot find these relationships. A shared poster does not establish identical video content.

## Decision
Add an independent bounded metadata scan of private stored posters for live single-video posts, grouping explicit MD5 plus poster size without equal video sizes/durations. Show review-only thumbnail suggestions and Watch links, with missing/unsupported/failed metadata counted as unverified. Keep exact-video cleanup validation unchanged. No perceptual matching, body hashing, migration or dependency.

## Consequences
Small metadata-only scan; no external image transfer or decoder. Same covers/intro images can suggest unrelated videos and differently encoded images can be missed. Results are non-transactional and session-local. Revisit approximate matching only after sample calibration; any thumbnail-based deletion requires separate approval/design.

Follow-up 2026-11-07: owner authorized per-card single-video deletion from suggestions; see ADR-0029. Matching rule unchanged.
