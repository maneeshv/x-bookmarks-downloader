# Wipe the store (switch X account, or start over)
When: the authorized X account changes, or R2/D1/KV must be emptied | Last verified: 2026-08-30 (executed)

The Worker, its secrets, Access, and the X developer app are untouched by this; only stored data and the
OAuth user change. `wrangler` has no `r2 object list`, so R2 keys are derived from D1 + the key scheme
(`<post_id>.mp4`, or `<post_id>-1..4.mp4` for multi-video posts). Run this **before** wiping D1.

## Steps
1. Pause the cron so a post bookmarked by both accounts cannot be skipped-then-deleted (value = epoch ms):
   ```bash
   npx wrangler kv key put paused_until "$(( $(date +%s) * 1000 + 30*60*1000 ))" --binding KV --remote   # value as an argument, not stdin
   ```
2. Delete every R2 object the sync could have written (deletes of missing keys exit 0):
   ```bash
   npx wrangler d1 execute x-downloader --remote --json --command "SELECT post_id FROM bookmarks WHERE status='downloaded'" \
     | python3 -c 'import sys,json; [print(r["post_id"]) for r in json.load(sys.stdin)[0]["results"]]' > /tmp/ids.txt
   while read id; do for k in "$id.mp4" "$id-1.mp4" "$id-2.mp4" "$id-3.mp4" "$id-4.mp4"; do
     npx wrangler r2 object delete "x-downloader-videos/$k" --remote >/dev/null 2>&1; done; done < /tmp/ids.txt
   ```
   (~1.5 s per call; 142 posts took ~10 min.) Spot-check: `npx wrangler r2 object get x-downloader-videos/<id>.mp4 --remote --pipe` → "key does not exist".
3. Empty D1 and the login state:
   ```bash
   npx wrangler d1 execute x-downloader --remote --command "DELETE FROM bookmarks"
   for k in oauth status userId; do npx wrangler kv key delete "$k" --binding KV --remote; done
   ```
   Only re-queue the failed rows instead? Raise the file-size limit on `/stats` if needed, then click **Retry all failed** (resets every `failed` row; `POST /api/videos/retry-all`). Raw SQL equivalent, scoped to one reason: `UPDATE bookmarks SET status='pending', error=NULL WHERE error='too_large'`.
4. Unpause: `npx wrangler kv key delete paused_until --binding KV --remote`.
5. Sign in to x.com as the account to archive, open `${PUBLIC_ORIGIN}/oauth/start`, approve; `/status` shows the new `userId`.
6. Capture: open `${PUBLIC_ORIGIN}/backfill` once. It records every bookmark before downloading (ADR-0023), so its JSON `recorded` is the bookmark count and `queued` is what is left to download; a browser timeout does not lose anything. Then watch `${PUBLIC_ORIGIN}/queue`: the cron drains 5 every 30 minutes. To go faster, open `/backfill?downloads=30` again (each call can take minutes with large files).

## Verify
`npx wrangler d1 execute x-downloader --remote --command "SELECT status, COUNT(*) FROM bookmarks GROUP BY status"` matches expectations; a video plays on `/`.

## Rollback
None — deleted objects are gone. The next `/backfill` re-downloads anything still bookmarked.
