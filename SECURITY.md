# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub security advisories:

https://github.com/gabrielvieiraf/finitemonkey/security/advisories/new

Do not open a public issue, pull request or discussion for a security problem. Do not include real secrets in the report; describe where a secret appears (file and line) instead of pasting its value.

Include what you can: the affected version, your platform, the steps to reproduce, what you expected and what happened. You will get an acknowledgement, and the fix will be coordinated with you before anything is made public.

## Supported versions

Finite Monkey is pre-release. No version is supported yet. Version `0.0.0` on npm is a name reservation and contains no code. Once releases start, security fixes go to the latest stable version.

## Design commitments (planned)

These describe how Finite Monkey is being built. Each one will be backed by a test before it is claimed as true for a release.

- Nothing leaves the user's machine by default. No telemetry.
- Secrets are never printed in output, logs, reports or pull requests; they are referenced by file and line.
- Guards fail closed: if a check cannot run, the action is blocked and the reason is shown.
- Packages are published only from CI, with npm provenance.

<!-- generated:footprint:start -->
## What it reads, writes and sends

Generated from `src/core/footprint.ts`, the list the tests hold the code to. No telemetry. Paths are relative to the project unless they start with `~`.

| | What | Why |
|---|---|---|
| Reads | `stdin` | The event Claude Code passes to each hook: the tool call, the prompt or the stop request. |
| Reads | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | Claude Code settings, to check that the hooks are installed and nothing switches them off. `$CLAUDE_CONFIG_DIR` replaces `~/.claude` when set. |
| Reads | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`, `.claudeignore` | Instruction files, read by `doctor` to report rules that exist only as text. |
| Reads | `~/.claude/projects/` | This project's local Claude Code session logs, read once and only with `init --look-back`. |
| Reads | `.git/` | The repository through the `git` command: status, diffs, refs and the reflog. |
| Reads | `git diff` | Changed files, scanned for secrets, test skips, placeholders and prose patterns. |
| Reads | `.finitemonkey/config.yml`, `.finitemonkey/policy.yml`, `.finitemonkey/briefing.md`, `.finitemonkey/look.yml` | Project configuration, the guard policy and the optional briefing for subagents. |
| Writes | `.claude/settings.json`, `.claude/settings.local.json`, `.claude/skills/verify/SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.finitemonkey/config.yml`, `.finitemonkey/lock.json`, `.finitemonkey/locks/`, `.finitemonkey/runtime/`, `.finitemonkey/backups/` | `init` and `update`: hook settings (and, with `--sandbox`, the sandbox in your local settings), the verify skill, a short managed block in `AGENTS.md` that `CLAUDE.md` imports, one `.gitignore` line, the pinned runtime and a backup of every file it changes. |
| Writes | `.finitemonkey/tasks/`, `.finitemonkey/state.json` | Task contracts and which task is active. |
| Writes | `.finitemonkey/evidence/`, `.finitemonkey/log.jsonl`, `.finitemonkey/prod-evidence.jsonl` | Evidence of each check, tied to the tree hash, and the gate log. |
| Writes | `.finitemonkey/trust.json`, `.finitemonkey/allow/`, `.finitemonkey/cache/` | Approvals and grants typed by the person, and a short-lived cache of open pull requests. |
| Writes | `.finitemonkey/findings/baseline.json`, `.finitemonkey/incidents/` | The accepted-findings baseline and exposure incidents. Both hold fingerprints and masks, never a secret value. |
| Writes | `.finitemonkey/git/`, `.finitemonkey/git-journal.jsonl`, `.finitemonkey/merge-dropped.json`, `refs/finitemonkey/backup/` | Snapshots before destructive git commands, the journal that `undo` reads and dropped-line decisions from merges. |
| Writes | `.finitemonkey/reports/` | Masked bug reports that `doctor --report` writes, only when asked. |
| Writes | `.git/finitemonkey/worktrees.yml`, `.git/finitemonkey/merges/`, `.git/info/exclude`, `.claude/worktrees/`, `~/.finitemonkey/worktrees/`, `~/.finitemonkey/archive/`, `refs/finitemonkey/archive/` | The worktree registry and merge reports in the git common dir (never committed), the local exclude line for `.claude/worktrees/`, and worktrees created by `wt new`; repos on `/mnt/<drive>` or a synced folder get theirs under `~/.finitemonkey/worktrees/`. `wt archive` saves a worktree into `refs/finitemonkey/archive/` and copies ignored files that are not secrets to `~/.finitemonkey/archive/`. |
| Writes | `.finitemonkey/look/` | Screen captures, the contact sheet and the JSON summary that `look` writes per tree hash. |
| Writes | `docs/plan/` | Plan documents under `docs/plan/`: the inventory of what the code does today, decision records, research records, cost models, the master plan from the first L task and the copy of it kept before each consolidation. |
| Writes | `.finitemonkey/map.txt` | The code map from `finitemonkey map`: one line per folder with its top-level definitions, cached by tree hash. |
| Writes | `.finitemonkey/review/`, `.claude/agents/verifier.md` | The review round count used by `review packet`, and, only when `review.playwright: true` is set in the config, a verifier agent with the Playwright MCP. |
| Sends | `api.github.com` | Through `gh`, only when it is installed and logged in: the state of the pull request named in a task, and your open pull requests for the session line. Code is never uploaded. |
| Sends | `127.0.0.1` | One request to your own app on the port a `runtime` check declares, after starting it or finding it running. Nothing goes past this machine. |
| Sends | `registry.npmjs.org`, `pypi.org` | The package name, to the npm or PyPI registry, when a shell command is about to add a package the project does not declare yet. Never with `FINITEMONKEY_OFFLINE=1`. |
| Sends | `api.github.com`, `api.stripe.com`, `api.openai.com`, `api.anthropic.com`, `api.digitalocean.com`, `api.cloudflare.com`, `api.asaas.com` | Through `curl`, only when you run `finitemonkey secrets live <provider> --env <VARIABLE> --send` yourself: one request with that key to the provider's API to see whether it still works. Off by default, never run by a hook, and the host is printed before anything is sent. |
<!-- generated:footprint:end -->
