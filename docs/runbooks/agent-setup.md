# Set up a new machine / teammate to work on this repo with Claude Code
When: first session on a new machine, or a teammate joins | Last verified: 2026-08-30 (owner's machine; plugin versions as of that date)

Everything the agent needs to *know* is in the repo (`CLAUDE.md`, `docs/`). This runbook covers only the *tools* that live outside the repo, at user scope, and therefore do not clone with it.

## Steps
1. Clone and open the repo:
   ```sh
   git clone <repo-url> x-downloader && cd x-downloader && claude
   ```
2. Install the plugins `CLAUDE.md` relies on (user scope; each is one command, run inside `claude` or from a shell):
   ```sh
   claude plugin install superpowers@claude-plugins-official   # brainstorming / writing-plans / TDD / verification skills (hard rule 6)
   claude plugin install context7@claude-plugins-official      # Context7 MCP for library facts (hard rule 5)
   claude plugin marketplace add cloudflare/skills
   claude plugin install cloudflare@cloudflare                 # wrangler + workers skills, cloudflare-docs MCP (no auth) and 4 authenticated Cloudflare MCPs
   ```
   Then `/reload-plugins` (or restart `claude`). Versions on 2026-08-29: superpowers 6.3.0, context7 0620a687ddd5, cloudflare 1.0.0.
3. Optional, only when deploying: `npm i -g wrangler` (or use `npx wrangler` from the project's `package.json` once it exists) and `wrangler login`. Never put Cloudflare or X credentials in the repo — see `docs/runbooks/setup-x-developer-app.md` and hard rule 1.
4. Optional Python tooling uses `uv` (owner preference, hard rule in `CLAUDE.md`): `curl -LsSf https://astral.sh/uv/install.sh | sh`.
5. Sandbox note: Claude Code's Bash sandbox blocks writes inside `.git`, so `git commit` prompts once per command to run unsandboxed. Accept it, or run `/sandbox` and allow `.git` for this project.
   **`git push` / `git fetch` over SSH fail inside the sandbox** (2026-08-31): the remote is the SSH alias `github.com-personal` (`~/.ssh/config`), and the sandbox blocks both `~/.ssh` reads and outbound SSH, so the error is the misleading "Please make sure you have the correct access rights and the repository exists". Run every push/fetch unsandboxed (`dangerouslyDisableSandbox`) on the first try — do not debug the remote.
   **`curl` against a deployed URL inside the sandbox is not a real answer** (2026-08-30): the egress proxy returns `502 Bad Gateway` or `200 Connection Established` for blocked hosts. Verify deployed URLs unsandboxed.
   **`gh pr create` cannot see this repo** (2026-08-31): `gh` is logged in only as the work account `maneesh-docketai`; the repo is `maneeshv/x-video-downloader` (private), so `gh` answers "Could not resolve to a Repository" whatever `-R` you pass — it is the account, not the name. Until the owner runs `gh auth login` for `maneeshv` (then `gh auth switch -u maneeshv`), push the branch and hand the owner the compare URL: `https://github.com/maneeshv/x-video-downloader/compare/main...<branch>?expand=1`.
   Rule of thumb: anything that touches the network, `~`, or a localhost listener (wrangler, git over SSH, curl verification, preview servers) runs unsandboxed on the first try; only file edits, tests and typecheck stay sandboxed.
   **Never run `wrangler` inside the sandbox** (confirmed again by `wrangler types` on 2026-09-02): `~/Library/Preferences/.wrangler` is read-only and localhost listeners fail with `listen EPERM`. Token rotation can therefore be lost and every later call fail with "auth token has expired and could not be refreshed" — only an interactive `wrangler login` recovers. Run every wrangler command unsandboxed (`dangerouslyDisableSandbox`), and if the token is already broken, either the owner runs `npx wrangler login` in a terminal, or the agent runs `npx wrangler login --browser=false` in the background and hands the printed URL to the owner (the callback lands on this machine). Temporary localhost preview servers need the same unsandboxed treatment.
6. Session-protocol hooks (ADR-0014) live in the committed `.claude/settings.json` + `.claude/hooks/session-protocol.sh` and need nothing installed (`jq`, `git`). They load at session start: a `Stop` that is blocked with "END protocol not satisfied" is the hook, not an error — do what it lists, then stop again. Per-session state: `$TMPDIR/x-downloader-hooks/<session_id>/`. Dry-run: `echo '{"session_id":"t","cwd":"'$PWD'","stop_hook_active":false}' | .claude/hooks/session-protocol.sh stop`.
7. The MCP servers that need OAuth (`cloudflare-api`, `cloudflare-bindings`, `cloudflare-builds`, `cloudflare-observability`) authenticate on first use via `/mcp`. `cloudflare-docs` and `context7` need no auth.

## Verify
- In `claude`, `/help` lists `superpowers:brainstorming`, `superpowers:writing-plans`, `cloudflare:wrangler`.
- `claude mcp list` shows `context7` and `plugin:cloudflare:cloudflare-docs` as Connected.
- Start a session and confirm the agent reads `docs/STATUS.md` first (the `CLAUDE.md` session protocol) before doing anything.
- `./scripts/check-session.sh` runs and prints `check-session: no code changes, ok`.

## Rollback
`claude plugin uninstall <name>` for each plugin; `claude plugin marketplace remove cloudflare`. Nothing in the repo changes.

## Not required
Any other plugin on the owner's machine (`ponytail`, `codex`, `atlassian`, `posthog`, `sentry`, …) is personal tooling. `CLAUDE.md` does not depend on them.

## Native browser fallback (2026-11-06)
If browser-extension inventory reports an unavailable Codex auth token, native Arc through
`cua.getApp("Arc")` can still support local QA. Rebind the app after a tool-session reset before
input; use fresh accessibility state and screenshots. This does not provide an authenticated
production session or justify claiming production UI verification.
