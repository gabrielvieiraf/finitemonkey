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
| Reads | `.git/` | The repository through the `git` command: status, diffs, refs and the reflog. |
| Reads | `git diff` | Changed files, scanned for secrets, test skips, placeholders and prose patterns. |
| Reads | `.finitemonkey/config.yml`, `.finitemonkey/briefing.md` | Project configuration and the optional briefing for subagents. |
| Writes | `.claude/settings.json`, `.claude/skills/verify/SKILL.md`, `.gitignore`, `.finitemonkey/config.yml`, `.finitemonkey/lock.json`, `.finitemonkey/locks/`, `.finitemonkey/runtime/`, `.finitemonkey/backups/` | `init` and `update`: hook settings, the verify skill, one `.gitignore` line, the pinned runtime and a backup of every file it changes. |
| Writes | `.finitemonkey/tasks/`, `.finitemonkey/state.json` | Task contracts and which task is active. |
| Writes | `.finitemonkey/evidence/`, `.finitemonkey/log.jsonl`, `.finitemonkey/prod-evidence.jsonl` | Evidence of each check, tied to the tree hash, and the gate log. |
| Writes | `.finitemonkey/trust.json`, `.finitemonkey/allow/`, `.finitemonkey/cache/` | Approvals and grants typed by the person, and a short-lived cache of open pull requests. |
| Writes | `.finitemonkey/findings/baseline.json`, `.finitemonkey/incidents/` | The accepted-findings baseline and exposure incidents. Both hold fingerprints and masks, never a secret value. |
| Writes | `.finitemonkey/git/`, `.finitemonkey/git-journal.jsonl`, `.finitemonkey/merge-dropped.json`, `refs/finitemonkey/backup/` | Snapshots before destructive git commands, the journal that `undo` reads and dropped-line decisions from merges. |
| Sends | `api.github.com` | Through `gh`, only when it is installed and logged in: the state of the pull request named in a task, and your open pull requests for the session line. Code is never uploaded. |
<!-- generated:footprint:end -->
