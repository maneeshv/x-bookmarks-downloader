# Open questions

Owner-facing. Each line: an OPEN marker, the date asked, options, the default the agent will assume if unanswered, and what it blocks. Resolved → ADR or journal line, then delete here.

- OPEN 2026-09-02: Rename the Library sort options "Largest"/"Smallest" to "Largest file"/"Smallest file"? The bare labels caused the owner to expect duration order (see JOURNAL 2026-09-02 duration sort entry). Default if unanswered: keep current labels — "Longest"/"Shortest" now cover duration. Blocks nothing.
- OPEN 2026-10-31: After save-first backfill, how many downloads should a bare `/backfill` attempt in the request? Options: 5 (same as a cron tick) / 0 (record only, cron downloads everything). Default if unanswered: 5. Blocks: plan `docs/superpowers/plans/2026-10-31-download-queue.md` step 3.
- OPEN 2026-11-06: For Reels, keep the same playable file per post as Library or expose every saved sibling file? Proposed spec default: Library parity; siblings need a separate inventory design. Blocks: final Reels scope approval; see [spec sections 1 and 12](superpowers/specs/2026-11-06-reels-view-design.md). Writing the spec did not resolve this choice.
- OPEN 2026-11-06: Should Reels share Watch's saved progress or use separate tab-session progress? Proposed spec default: separate, with no `resume_ms` reads/writes from Reels; loop the current clip until a manual swipe rather than auto-advance. Blocks: final behavior approval; see [spec sections 1, 6 and 12](superpowers/specs/2026-11-06-reels-view-design.md). Recommendations do not authorize implementation.
