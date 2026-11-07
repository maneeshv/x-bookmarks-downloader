# 0029. Delete single videos from thumbnail suggestion cards
Date: 2026-11-07 | Status: DECIDED

## Context
ADR0025 and ADR0028 kept identical- and similar-thumbnail suggestions review-only and said thumbnail-based deletion "requires a separate design and authorization". On 2026-11-07 the owner asked for that: once a suggestion looks like a duplicate, they had to open the detail page to delete it, and coming back lost the in-memory scan results. They asked for a delete button on every card in both suggestion lists, matching the exact-video scan. They also asked for inline playback on approximate cards. Those cards already render a `<video controls>` with `/v/:key` (verified 2026-11-07 in headless Chromium: playback advanced), so no playback change was made. See the JOURNAL entry for the follow-up question.

## Decision
Each suggestion card gets **Delete this video**. It calls the existing owner-only `DELETE /api/videos/:id` (same route, R2-first tombstone and byte accounting as the detail page, ADR-0011). No new endpoint, keeper selection, checksum precondition, migration or dependency.

- A native `confirm` names the title, post id and size and says there is no undo. Cancel sends nothing.
- Only a 204 counts as success. A 404/500/network error leaves the card and reports in that list's status line.
- On success, every card for that post in both suggestion lists is replaced in place by a "Deleted from the library" marker (stopping playback). The rest of the results stay, so the owner keeps reviewing without rescanning.
- The exact-video state `forget(postId)` drops the post from exact groups/selections, so exact cleanup never targets a tombstoned row. A group left with one copy disappears. This does not mark the exact scan stale.
- Delete buttons share the page-wide lock: disabled while any scan or deletion is in flight.

Thumbnail similarity is still only a suggestion. The decision to delete stays with the owner, who can play both videos inline first. Exact-video cleanup semantics (ADR0024) are unchanged.

## Revisit when
The owner wants batch deletion from suggestions, undo, or merging metadata (title/tags/favourite) into the kept copy. Each needs its own design. Also revisit if a server-side precondition is needed, e.g. multiple tabs deleting concurrently become a real problem.
