# Deploy the Worker
When: first deploy, or after a code/config change needs redeploying | Last verified: 2026-10-31

`wrangler.toml` is local and gitignored (copy `wrangler.toml.example`, fill in real ids). Network
`wrangler`/`npm` calls need the Bash sandbox off (EPERM otherwise).

## Before every deploy (added 2026-08-30 after a stale-config deploy; caught a second stale copy on 2026-08-31)
`wrangler.toml` is gitignored, so each git worktree carries its own copy — Paseo's bootstrap copies it from the main checkout, which may predate a config change merged from another worktree. On 2026-08-30 a worktree deployed with the pre-xrender.uk file: workers.dev came back on and `PUBLIC_ORIGIN` reverted (fixed by a redeploy 5 minutes later). So, first:
```bash
# temp files, not <(…): process substitution fails inside the Claude Code sandbox (/dev/fd: Operation not permitted)
grep -v -E '^\s*(#|$)' wrangler.toml.example | grep -v -E '^(id|database_id) =' > "$TMPDIR/a"
grep -v -E '^\s*(#|$)' wrangler.toml         | grep -v -E '^(id|database_id) =' > "$TMPDIR/b"
diff "$TMPDIR/a" "$TMPDIR/b"
```
Expect no output apart from the real `TEAM_DOMAIN`/`POLICY_AUD`/`OWNER_EMAIL` values. Any
`routes`/`PUBLIC_ORIGIN`/`[vars]` difference: copy the example's lines into `wrangler.toml` before
`npx wrangler deploy`. After deploying, the printed triggers must list `xrender.uk (custom domain)` —
a bare workers.dev URL means the config was stale.

## Steps executed 2026-08-30 (agent, Task 9 part)

### 1. Create resources (once)
```bash
npx wrangler r2 bucket create x-downloader-videos
npx wrangler kv namespace create KV            # paste the returned "id" into wrangler.toml [[kv_namespaces]]
npx wrangler d1 create x-downloader             # paste the returned "database_id" into wrangler.toml [[d1_databases]]
```
If a resource already exists, reuse it instead of recreating:
```bash
npx wrangler r2 bucket list
npx wrangler kv namespace list
npx wrangler d1 list
```
Resource ids created 2026-08-30 (not secrets, safe to record):
- R2 bucket: `x-downloader-videos`
- KV namespace id: `8881b4cf4a9c43ab9eba7351c09be8f7`
- D1 database: `x-downloader`, id `39ad612c-fad7-4fbe-b6c4-23cfbfddeed3` (region APAC)

### 2. Apply the D1 migration
```bash
npx wrangler d1 migrations apply x-downloader --remote   # answer yes if prompted
```
This applies every pending file in `migrations/` (as of 2026-09-03: `0001_bookmarks.sql`,
`0002_library.sql`, `0003_duration.sql`, `0003_tags.sql`). Run it **before** `wrangler deploy` whenever `migrations/` changed — the new
code reads the new columns immediately, so deploying first would 500 on the first request that
touches them.

Verify:
```bash
npx wrangler d1 execute x-downloader --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```
Expect `bookmarks`, `d1_migrations` (plus sqlite/D1 internal tables).

### 3. Deploy on the custom domain (ADR-0012)
`wrangler.toml` carries `[[routes]] pattern = "xrender.uk", custom_domain = true` and
`[vars] PUBLIC_ORIGIN = "https://xrender.uk"`. The zone must be active in the same Cloudflare
account and the hostname must have no pre-existing CNAME; then:
```bash
npx wrangler deploy      # ends with: "xrender.uk (custom domain)" under "Deployed x-downloader triggers"
```
Wrangler creates the DNS record and certificate itself. Because a route exists, `workers_dev` is
inferred `false` and `https://x-downloader.x-downloader.workers.dev` returns 404 (set
`workers_dev = true` temporarily if a cutover needs both). Verify:
```bash
curl -si https://xrender.uk/status | head -1   # expect: HTTP/2 302 (to the Access login); 403 before Access is attached
```
Done 2026-08-30 (version `3fc29825-fde6-4f4e-92ab-c120497d7942`): DNS was live within seconds.
Gotcha (hit 2026-08-30): any lookup on the deploying Mac made before wrangler created the record
leaves a **negative A-record entry in mDNSResponder for the zone's SOA minimum = 1800 s (30 min)**;
`dig` (asks upstream directly) answers, but `dscacheutil -q host -a name xrender.uk` shows only AAAA,
so curl says "Could not resolve host" / hangs and Chrome (incl. the Paseo tab) lands on
`chrome-error://chromewebdata/`. Fix: `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`
(needs a password — owner), `curl --resolve xrender.uk:443:<dig answer>`, or wait 30 min. Avoid it next
time by not resolving the name before `wrangler deploy` finishes.
History: 2026-08-30 08:xx–17:xx the origin was `https://x-downloader.x-downloader.workers.dev`.

### 4. Set vars (`TEAM_DOMAIN`, `POLICY_AUD`, `PUBLIC_ORIGIN`, `OWNER_EMAIL`)
Edit `wrangler.toml` `[vars]` directly, then `npx wrangler deploy`. `PUBLIC_ORIGIN` is already set
(step 3); `TEAM_DOMAIN`/`POLICY_AUD` need Access enabled first (step 6 below). `OWNER_EMAIL` is the
verified Cloudflare Login address that receives owner capabilities. Missing or blank fails closed:
authenticated users remain viewers and every owner-only route returns 403.

### 5. Secrets
```bash
npx wrangler secret put X_CLIENT_ID          # done 2026-08-30, read from .env, never echoed
npx wrangler secret put X_CLIENT_SECRET      # done 2026-08-30, ditto
npx wrangler secret put TELEGRAM_BOT_TOKEN   # done 2026-08-30, read from .env, never echoed
npx wrangler secret put TELEGRAM_CHAT_ID     # done 2026-08-30 (getUpdates only shows messages <24 h old — resend if empty)
```
Read a secret value from `.env` without ever printing it:
```bash
sed -n 's/^SECRET_NAME=//p' .env | tr -d '"'"'"' ' | npx wrangler secret put SECRET_NAME
```
Verify names only (never values):
```bash
npx wrangler secret list
```
Done 2026-08-30: `TELEGRAM_BOT_TOKEN`. Remaining (owner-blocked, see `docs/STATUS.md`):
`X_CLIENT_ID`, `X_CLIENT_SECRET`, `TELEGRAM_CHAT_ID`.

## Owner steps (not run 2026-08-30)

### 6. Enable Cloudflare Access and admit exact-email viewers
(Done 2026-08-30 on the workers.dev route; the app is Worker-scoped, "All traffic", so it covered
`xrender.uk` automatically with the same AUD when the custom domain was added — verified by the
302 in step 3. Nothing to redo for a hostname change.)
Dashboard: **Workers & Pages → x-downloader → Domains tab** (older dashboards: **Settings → Domains &
Routes**) → **Production** workers.dev row → the **Enable Access →** link (leave the Preview row alone) → **Manage** / the
Worker's **Access** tab → the auto-created
policy `x-downloader - Production` → set the policy as described below. Sources: Cloudflare
changelog 2025-10-03 (one-click Access), 2025-12-03 (reusable `<worker> - Production` policy), 2026-05-14 (Domains tab).
Then **Zero Trust → Access controls → Applications →** the app created for this route → copy the
**Application Audience (AUD) Tag**. The team domain is `https://<team>.cloudflareaccess.com`
(shown in Zero Trust → Settings → Custom Pages, or the URL of the Zero Trust dashboard itself).
Put both into `wrangler.toml` `[vars] TEAM_DOMAIN` / `POLICY_AUD`, then `npx wrangler deploy`.
Done 2026-08-30: `TEAM_DOMAIN = "https://orange-sky-811f.cloudflareaccess.com"`,
`POLICY_AUD = "51d1e95c9f203c9af5c21913bcaf90c001acd25aa195221228229ea0f3ede47c"` (both public — they appear in the
Access login redirect — so recorded here for rebuilding `wrangler.toml`). Verified: `curl -si …/status` → `HTTP/2 302`
to `<TEAM_DOMAIN>/cdn-cgi/access/login/…?kid=<POLICY_AUD>`. In the dialog, choose Scope **All traffic** (default is
Previews only, which leaves production public). Under **Zero Trust → Access controls → Applications →
`x-downloader - Cloudflare Workers` → Login methods**, enable **Cloudflare** and disable One-time PIN.

For the read-only-viewer rollout (ADR-0019), order is mandatory:

1. Deploy the Worker with the verified `OWNER_EMAIL` while the existing **Cloudflare account members**
   policy still admits only the owner. Verify Library, watch, metadata save, favourite, delete using a
   disposable item if available, retry, file-limit save, backfill, status, and X reauthorization.
2. Audit every other Access application that uses Cloudflare Login. The identity-provider setting below
   is account-wide, so each affected application must already have a narrow policy.
3. Under **Zero Trust → Integrations → Identity providers → Cloudflare → Configure**, disable
   **Restrict to account members**. Current dashboard reference:
   https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/.
4. Edit the existing x-downloader Access application; do not create another application or change its
   AUD. Replace the **Cloudflare account members** Include with one exact **Emails** Include containing
   only the owner. Do not append a broader selector or add a second Allow policy. Verify the owner in a
   fresh session.
5. The viewer creates their own free Cloudflare account and verifies its email; do not invite them to
   the owner's Cloudflare account or grant a dashboard role. Add that exact email to the policy, then
   send `https://xrender.uk` to the viewer manually—Access does not send an application invitation.
   Verify `/`, `/watch/:id`, `/v/:key` including download, and `/p/:id`; directly verify `/stats`, `/status`,
   `/oauth/start`, `/oauth/callback`, `/backfill`, and `/api/*` return 403 and owner controls are absent.
6. Verify a non-listed Cloudflare account is rejected at the Access screen, then add remaining viewers.

The full-address **Emails** selector is in Zero Trust → Access controls → Policies; the Worker's quick
dialog may only offer **Email domain**, which would be too broad.

### 7. X app callback URL
In console.x.com, the app's **User authentication settings** callback URL must be exactly
`${PUBLIC_ORIGIN}/oauth/callback` — for this deploy: `https://xrender.uk/oauth/callback`
(was `https://x-downloader.x-downloader.workers.dev/oauth/callback` until 2026-08-30; **owner must
update it in console.x.com after the domain switch** — until then `/oauth/start` fails at X's consent
screen, while the cron keeps working on the tokens already in KV).
See `docs/runbooks/setup-x-developer-app.md` for the full app-creation steps (needs the OAuth 2.0
Client ID/Secret, not the OAuth 1.0a keys already in `.env`).

### 8. Get `TELEGRAM_CHAT_ID`
Send any message to the bot from the Telegram account that should receive alerts, then:
```bash
curl https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
```
Read `message.chat.id` from the JSON response. Feed it to `wrangler secret put TELEGRAM_CHAT_ID`.

### 9. Authorize + backfill
Open `${PUBLIC_ORIGIN}/oauth/start` in a browser (logs in through Access, then the X consent
screen). `${PUBLIC_ORIGIN}/status` should then show `auth: "ok"`. Open `${PUBLIC_ORIGIN}/backfill`
once — expect JSON with `pages`, `seen`, `recorded`, `downloaded`, `queued`; `/queue` lists what is still waiting. Open `${PUBLIC_ORIGIN}/` and confirm a video
plays.

If the JSON shows `seen > 0` and `downloaded == 0` (and `/status` `counts.failed` is 0), the field
parameter may have been renamed: change `tweet.fields` to `post.fields` in `BOOKMARK_QUERY`
(`src/limits.ts`), redeploy, re-run `/backfill`. See `docs/research/2026-08-29-x-api-v2.md`.

### Durable-poster rollout (ADR-0018)
Do this as two deployments so X-backed rendering remains intact while existing posters are copied.

1. Deploy poster capture, authenticated `/p/:postId`, combined video/poster deletion, and the
   poster-only backfill while Library and Watch still render their existing X URLs.
2. In an authenticated browser, open `/backfill?posters=30`. For each response, record
   `postersStored`, `postersExisting`, `postersUnavailable`, and `posterFailures`, then pass its
   `nextAfter` into `/backfill?posters=30&after=<nextAfter>`. Stop only when `nextAfter` is `null`.
   The current 198-row library needs about seven requests, but request count is not proof of
   completion.
3. Compare the sum of successful (`postersStored + postersExisting`) and unsuccessful
   (`postersUnavailable + posterFailures`) results with the eligible downloaded, non-deleted rows
   whose `preview_url` is present. Investigate every unsuccessful row and rerun from the beginning
   after transient failures; the operation is idempotent.
4. Only after every recoverable poster is stored, deploy Library and Watch rendering with
   same-origin `/p/<postId>` URLs.
5. Reload the first and last Library pages and representative Watch pages. In browser network logs,
   confirm poster requests use `/p/`, no request targets `pbs.twimg.com`, and every poster has
   non-zero natural dimensions. An unrecoverable source must show the stable placeholder.

Rollback either deploy with the normal Worker rollback below. Rolling back the rendering cutover
restores X URLs; poster objects already copied to private R2 are harmless and can remain for retry.

Executed 2026-09-02: phase one was `4c07dca3-7b47-4d35-8cae-38205aa9e0d0`; seven authenticated
Paseo-browser batches stored all 198 eligible posters with no unavailable sources or failures; and
the same-origin cutover is `8df14d41-e59d-4f7e-b8b8-95d302efebe3` at 100%. First/last Library
pages and Watch were checked with non-zero poster dimensions and no `pbs.twimg.com` requests.
Use phase one for a rendering-only rollback or `c0852a7b-a9b7-49b4-a4d3-b83682928919` for a full
pre-feature rollback.

### 10. Verify the cron
After ≤30 minutes, dashboard → Worker → **Cron Events** shows a successful invocation, and
`${PUBLIC_ORIGIN}/status` `lastRun` has advanced. Check console.x.com → usage: a handful of reads
per day, not hundreds (spec assumption; see `docs/GOTCHAS.md` "Owned Reads" line if the count is
surprising).

## Rollback
- Bad friend admission: remove viewer emails, revoke their active Access sessions, restore **Restrict
  to account members**, and restore the former **Cloudflare account members** policy. The Worker guard
  can remain deployed. Removing a policy email without session revocation may not cut off an active
  session immediately.
- Bad deploy: `npx wrangler deployments list` then `npx wrangler rollback [--version-id <id>]`.
- Bad migration: D1 migrations are additive-only in this repo (no down-migrations written yet); fix
  forward with a new numbered migration file.
- Compromised secret: `npx wrangler secret put <NAME>` with a new value overwrites in place; revoke
  the old value at the source (X app / Telegram BotFather) too.
- Stop the service entirely: `npx wrangler deployments list` → deploy an earlier version id, or
  delete the cron trigger by removing `[triggers]` from `wrangler.toml` and redeploying.
