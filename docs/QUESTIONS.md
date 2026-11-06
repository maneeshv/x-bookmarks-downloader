# Open questions

Owner-facing. Each line: an OPEN marker, the date asked, options, the default the agent will assume if unanswered, and what it blocks. Resolved → ADR or journal line, then delete here.

- OPEN 2026-11-06: Approve the [proposed Duplicates spec](superpowers/specs/2026-11-06-duplicate-video-review-design.md)? Options: exact-match single-video review with manual cleanup as specified / revise scope. Default if unanswered: spec remains PROPOSED, no implementation. Blocks: implementation plan and product changes; writing the spec was explicitly requested.

- OPEN 2026-09-02: Rename the Library sort options "Largest"/"Smallest" to "Largest file"/"Smallest file"? The bare labels caused the owner to expect duration order (see JOURNAL 2026-09-02 duration sort entry). Default if unanswered: keep current labels — "Longest"/"Shortest" now cover duration. Blocks nothing.
- OPEN 2026-10-31: After save-first backfill, how many downloads should a bare `/backfill` attempt in the request? Options: 5 (same as a cron tick) / 0 (record only, cron downloads everything). Default if unanswered: 5. Blocks: plan `docs/superpowers/plans/2026-10-31-download-queue.md` step 3.
