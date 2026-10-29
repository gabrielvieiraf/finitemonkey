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
- Guards that prevent damage fail closed: if the gate cannot run, the stop is held once with the reason and the fix, the next stop goes through recorded as not run, and `pr open` and `ci gate` refuse until a real run passes. Advisory guards fail open. The table below lists each one.
- Packages are published only from CI, with npm provenance.
- Each line of the evidence ledger is signed with an HMAC key kept in `~/.finitemonkey/ledger.key`, outside the project. The gate ignores and reports lines without a valid signature and reuses evidence only while the hook entry points and its own scripts hash the same. A process that can read your home folder can still sign lines: this raises the cost of tampering, it does not prevent it.

<!-- generated:guard-failure-modes:start -->
Generated from `GUARD_SETS` in `src/hooks/handlers.ts`. Guards that prevent damage fail closed; advisory guards fail open.

| Guard | Failure mode |
|---|---|
| `secrets` | closed: when it cannot run, the action is blocked with the reason; at `Stop` the gate holds once and then records not run |
| `gate` | closed: when it cannot run, the action is blocked with the reason; at `Stop` the gate holds once and then records not run |
| `prose` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `git` | closed: when it cannot run, the action is blocked with the reason; at `Stop` the gate holds once and then records not run |
| `deps` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `creds-static` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `appsec` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `rules` | closed: when it cannot run, the action is blocked with the reason; at `Stop` the gate holds once and then records not run |
| `signals` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `fourth-attempt` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `ricochete` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `planta` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `label` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `perfil` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `conceitos` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `relay` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `reuse` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `quality` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `slop` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `tests-hold` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `advisor` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `claims` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `clarify` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `deploy` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `wt-suggest` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `heavy-lock` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `instructions` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `rules-stop` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `reminders` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `learnings` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `syntax-check` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `early-loops` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `reproduce-first` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `scope` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `front-scope` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `predict-gate` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `decision-hold` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `assumptions` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `reality` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `guardian-reuse` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `proportionality` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `forecast` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
| `evolve` | open: when it cannot run, the action goes through and `guard_failed_open` is logged |
<!-- generated:guard-failure-modes:end -->

<!-- generated:footprint:start -->
## What it reads, writes and sends

Generated from `src/core/footprint.ts`, the list the tests hold the code to. No telemetry. Paths are relative to the project unless they start with `~`.

| | What | Why |
|---|---|---|
| Reads | `stdin` | The event Claude Code passes to each hook: the tool call, the prompt or the stop request. |
| Reads | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | Claude Code settings, to check that the hooks are installed and nothing switches them off. `$CLAUDE_CONFIG_DIR` replaces `~/.claude` when set. |
| Reads | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`, `.claudeignore` | Instruction files, read by `doctor` to report rules that exist only as text. |
| Reads | `~/.claude/projects/` | This project's local Claude Code session logs: read once with `init --look-back`, and read incrementally on each prompt only when a spend budget is set in `.finitemonkey/config.yml`. |
| Reads | `~/.claude/plugins/`, `~/.claude/debug/latest` | `doctor` reads installed plugins and their hook files to list every hook and find conflicts; `doctor --hooks` also reads the latest Claude Code debug log for hook timings. It never changes another plugin's files. |
| Reads | `.git/` | The repository through the `git` command: status, diffs, refs and the reflog. |
| Reads | `git diff` | Changed files, scanned for secrets, test skips, placeholders and prose patterns. |
| Reads | `.finitemonkey/config.yml`, `.finitemonkey/policy.yml`, `.finitemonkey/briefing.md`, `.finitemonkey/look.yml`, `.finitemonkey/appsec.yml`, `.finitemonkey/routes-public.yml`, `.finitemonkey/rules.yml`, `.finitemonkey/arch.yml` | Project configuration, the guard policy and the optional briefing for subagents. |
| Reads | `.finitemonkey/profile.yml`, `~/.finitemonkey/profile.yml` | The person's level per domain; the infrastructure level picks the git defaults (intermediate when missing). |
| Reads | `~/.claude/CLAUDE.md`, `~/.claude/rules/`, `/etc/claude-code/CLAUDE.md`, `../CLAUDE.md` | `finitemonkey instructions` and `doctor` read every instruction file Claude Code would load: the managed `CLAUDE.md`, your `~/.claude/CLAUDE.md` and `~/.claude/rules/`, and each `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md` from the folder you work in up to the disk root, to list them and find rules that contradict each other. |
| Writes | `.claude/settings.json`, `.claude/settings.local.json`, `.claude/skills/verify/SKILL.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.finitemonkey/config.yml`, `.finitemonkey/lock.json`, `.finitemonkey/locks/`, `.finitemonkey/runtime/`, `.finitemonkey/backups/` | `init` and `update`: hook settings (and, with `--sandbox`, the sandbox in your local settings), the verify skill, a short managed block in `AGENTS.md` that `CLAUDE.md` imports, one `.gitignore` line, the pinned runtime and a backup of every file it changes. |
| Writes | `.finitemonkey/tasks/`, `.finitemonkey/state.json` | Task contracts and which task is active. |
| Writes | `.finitemonkey/evidence/`, `.finitemonkey/log.jsonl`, `.finitemonkey/prod-evidence.jsonl` | Evidence of each check, tied to the tree hash, and the gate log. |
| Writes | `.finitemonkey/trust.json`, `.finitemonkey/allow/`, `.finitemonkey/cache/` | Approvals and grants typed by the person, and a short-lived cache of open pull requests. |
| Writes | `.finitemonkey/findings/baseline.json`, `.finitemonkey/incidents/` | The accepted-findings baseline and exposure incidents. Both hold fingerprints and masks, never a secret value. |
| Writes | `.finitemonkey/git/`, `.finitemonkey/git-journal.jsonl`, `.finitemonkey/merge-dropped.json`, `refs/finitemonkey/backup/`, `.git/finitemonkey/snapshots/` | Snapshots before destructive git commands and `rm` in the repository, with copies of ignored and untracked secret files up to 50 MB inside .git, the journal that `undo` reads and dropped-line decisions from merges. |
| Writes | `.finitemonkey/reports/` | Masked bug reports that `doctor --report` writes, only when asked, and the report each front writes before it stops. |
| Writes | `.finitemonkey/pr/` | Who accepted files outside the task scope in `pr open`, when and why, one file per branch. |
| Writes | `.finitemonkey/fronts.yml`, `.finitemonkey/briefing.md` | The state of a wave of parallel fronts (scope, worktree, branch, port, agent, status and inbox of each front) and the briefing every front prompt cites. Local, never committed. |
| Writes | `.finitemonkey/github-ruleset.json` | The ruleset `init --github` proposes when the default branch has none; it is sent to GitHub only after the person says yes. |
| Writes | `.git/finitemonkey/worktrees.yml`, `.git/finitemonkey/merges/`, `.git/info/exclude`, `.claude/worktrees/`, `~/.finitemonkey/worktrees/`, `~/.finitemonkey/archive/`, `refs/finitemonkey/archive/` | The worktree registry and merge reports in the git common dir (never committed), the local exclude line for `.claude/worktrees/`, and worktrees created by `wt new`; repos on `/mnt/<drive>` or a synced folder get theirs under `~/.finitemonkey/worktrees/`. `wt archive` saves a worktree into `refs/finitemonkey/archive/` and copies ignored files that are not secrets to `~/.finitemonkey/archive/`. |
| Writes | `.finitemonkey/creds.yml` | `creds` writes the credential inventory: variable names, where they are read, environments, type and risk. Never a value. |
| Writes | `.finitemonkey/findings/osv.json`, `.github/dependabot.yml`, `renovate.json` | `deps scan` keeps the date each known vulnerability was first seen, so its deadline holds between runs. `deps config --write` saves the Dependabot or Renovate file; without `--write` it only prints it. |
| Writes | `$FINITEMONKEY_HOLD_DIR/<session>.hold.json` | Only with `supervisor: enabled: true` in the config: a short-lived hold file per session in the directory an account-switching supervisor announces, while the gate runs or holds the stop. `gain` reads that directory's `usage.json`. |
| Writes | `.finitemonkey/semgrep/`, `.finitemonkey/data-map.yml` | `appsec rules --write` saves the semgrep rules generated for the detected stack, for CI to run; without `--write` it only prints them. `data-map` writes one row per personal field found in the schema (names only). |
| Writes | `.finitemonkey/rules-compiled.json`, `.github/workflows/finitemonkey-rules.yml` | `rules compile` writes, per rule in `.finitemonkey/rules.yml`: deny entries and settings keys in `.claude/settings.json`, a line in `AGENTS.md`, the list of what it wrote, and with `--ci` a workflow that checks the rules on pull requests. `uninstall` removes all of it. |
| Writes | `.finitemonkey/look/` | Screen captures, the contact sheet and the JSON summary that `look` writes per tree hash. |
| Writes | `.finitemonkey/prompts.jsonl` | What you type to Claude Code in this project, with secrets masked, so `finitemonkey audit` can find requests and decisions that never reached a document. It stays on this machine. |
| Writes | `.finitemonkey/spend.json`, `.finitemonkey/spend-reconcile.jsonl` | Agent spend estimated from the local session logs, per task, day and month, and the differences found by `cost reconcile`. |
| Writes | `docs/plan/` | Plan documents under `docs/plan/`: the inventory of what the code does today, decision records, research records, cost models, the master plan from the first L task and the copy of it kept before each consolidation. |
| Writes | `.finitemonkey/map.txt` | The code map from `finitemonkey map`: one line per folder with its top-level definitions, cached by tree hash, and the log of reuse warnings with whether each one led to reuse. |
| Writes | `.finitemonkey/signals.jsonl`, `.finitemonkey/signals-index.json`, `.finitemonkey/signals-profile.json` | Loop signals from `finitemonkey signals`: error signatures, edit hashes and prompt fingerprints (hashed word pairs, never the text), the loop index and the calibrated thresholds. Deleted by `signals forget`. |
| Writes | `.finitemonkey/perfil.yml`, `.finitemonkey/perfil-commits.json`, `.finitemonkey/conceitos.yml` | The per-domain profile of the person from `finitemonkey perfil`: tool literacy and domain knowledge per domain, raised by technical words in requests and by commits made outside the session, and the concept book with the level shown for each concept seen in the project. Never committed and never in PR text or reports. Deleted by `perfil forget`. |
| Writes | `.finitemonkey/runs/` | The full output of commands run through `finitemonkey run`, with secrets masked; the 30 most recent are kept. |
| Writes | `.finitemonkey/map.txt`, `.finitemonkey/reuse.json` | The code map from `finitemonkey map`: one line per folder with its top-level definitions, cached by tree hash, and the log of reuse warnings with whether each one led to reuse. |
| Writes | `.finitemonkey/review/`, `.claude/agents/verifier.md` | The review round count used by `review packet`, and, only when `review.playwright: true` is set in the config, a verifier agent with the Playwright MCP. |
| Writes | `.finitemonkey/regression/` | A throwaway git worktree at the base commit, used to check that the test added in a bug fix fails without the fix. It is removed after the run. |
| Writes | `.finitemonkey/suggestions.jsonl` | Refactoring suggestions shown at the end of a task after the gate passes, with whether each was accepted, dismissed or closed. Nothing is changed in the code. |
| Writes | `~/.finitemonkey/heavy/` | One lock file per running install, build or full test run, shared by every worktree on the machine, so they run one at a time (by default on WSL). |
| Writes | `.finitemonkey/instructions.jsonl` | The `InstructionsLoaded` hook appends one line per instruction file Claude Code loads: the session, the path, why it loaded and when. `finitemonkey instructions` compares it with what it resolved. No file content is copied. |
| Writes | `.finitemonkey/rules.yml`, `.finitemonkey/rule-violations.jsonl` | `rules propose` adds to `.finitemonkey/rules.yml` only the entries you confirm in a terminal. Every rule broken at the end of a turn, blocked by a guard or reported with `rules violation` gets one line in `rule-violations.jsonl` (rule, source, masked detail), the evidence for promoting a reminder. |
| Writes | `.finitemonkey/learnings.jsonl` | Lessons from earlier work: a short text keyed by file paths or by the signature of an error that stopped after a change, how often each was used and when it last matched. A lesson unused for 90 days or marked unhelpful twice is deleted; `learnings delete` removes one by hand. |
| Writes | `.finitemonkey/ownership.yml` | `gen ownership` writes one entry per component (name, vocabulary type, owner, consumers) after the person passes `--yes`; `ci gate`, `ownership check` and `plan check` read it, or read `catalog-info.yaml` when that exists. |
| Writes | `.finitemonkey/ci-protect.jsonl` | One line per GitHub setting `ci protect` changed after the person's yes in a terminal: when, the repository, the setting, the value before and after, and whether GitHub accepted it. The settings it read are cached in `.finitemonkey/cache/github-settings.json` for `doctor`. |
| Writes | `.finitemonkey/ci-watch/` | `ci-watch` keeps, per pull request, the commits whose CI failed and when the watch started, plus one line per run with the commit, each check's result, the failure class and the attempt. Failed logs are read through `gh` with secrets masked and only their last lines are shown, never stored. |
| Writes | `.finitemonkey/infra.yml`, `.finitemonkey/hosts.local.yml` | How the project deploys, read from its own files when you run `finitemonkey infra`: level, targets and risks with `file:line`, no address. Production hosts found in deploy files go to `hosts.local.yml`, which git ignores, and only when the `.gitignore` block is there. |
| Writes | `observability/scrub.mjs`, `observability/log.mjs`, `observability/plan.yml` | Only with `finitemonkey observe --yes`, and only files that do not exist yet: an error-report scrubber, a JSON logger with an allow-list of fields and, from level 2, a plan to fill in. No account is created anywhere. |
| Writes | `.github/workflows/deploy.yml`, `.github/workflows/drift.yml`, `deploy/remote.sh`, `deploy/compose.yml` | Only with `finitemonkey deploy generate --yes`, and only files that do not exist yet: the deploy and drift workflows, the script the server runs and its compose file. An existing file is never overwritten; its diff is shown instead. |
| Writes | `.finitemonkey/golden/` | Expected outputs of golden cases, one file per case, plus `accepted.jsonl` with who recorded each one and when. Only `finitemonkey golden accept`, run by the person in a terminal, writes them. |
| Writes | `docs/organize/` | `finitemonkey organize plan <file>` writes a split plan skeleton for that file, only when the plan does not exist yet: responsibilities with line ranges and the sequence of small steps. The hotspot ranking itself is cached in `.finitemonkey/cache/`. |
| Writes | `src/api/`, `src/mocks/`, `app/api/`, `app/mocks/`, `lib/api/`, `lib/mocks/` | Only with `finitemonkey contract --write` or `contract mocks --write`: the endpoint registry, typed client, error envelope and coverage test under `api/`, and the MSW mocks under `mocks/`, in `src/`, `app/` (Remix) or `lib/` (Next without `src/`), generated from `api/contract.yml`. Existing files are never replaced unless the person passes `--overwrite` in a terminal. |
| Writes | `.github/workflows/ds-sync.yml` | Only with `finitemonkey ds-sync init --write`: a workflow that copies the design system from the prototype repository through an organization GitHub App and keeps one pull request updated. `ds-sync issue --yes`, run by the person or by that workflow, opens or edits issues through `gh`, rewriting only the section between its markers. |
| Writes | `ruff.toml`, `pytest.ini`, `scripts/check_no_comments.py`, `.github/workflows/ci.yml` | Only with `finitemonkey preset python --write` in a Python project: ruff rules for complexity and length, pytest options that fail on unknown markers, a script that rejects code comments, import-linter contracts when `.finitemonkey/arch.yml` exists, and a CI workflow on `uv sync --locked`. An existing file is shown as a diff and kept. |
| Writes | `.finitemonkey/onboard.json`, `AGENTS.md` | `finitemonkey onboard` runs the build, test, lint and typecheck commands it finds in the manifests and in AGENTS.md or CLAUDE.md, with a time limit, and keeps in `onboard.json` and in its own AGENTS.md block only the ones that succeeded, plus the number of possible secrets found by a one-time scan of the git history. Commands that deploy, publish, install or keep running are not run. |
| Writes | `~/.finitemonkey/ledger.key` | A random key, created the first time evidence is written, that signs every line of the evidence ledger. It stays in your home folder, outside the project, readable only by you. Lines without a valid signature are ignored and reported; deleting the key makes old evidence count as not run. |
| Writes | `.finitemonkey/goals.yml`, `.finitemonkey/decisions.jsonl`, `.finitemonkey/assumptions.jsonl`, `.finitemonkey/research/` | Project goals, constraints, non-goals, done criteria and rejected options. An entry added from inside Claude Code is `inferred` and never counts as approved; only `finitemonkey guardian goal confirm`, run by the person in a terminal, marks it `stated`. The optional `context:` section (stage, demonstrated concepts, who operates, next milestone) follows the same rule: inferred fields can only silence a report. `decisions.jsonl` keeps each accepted decision and each level 2-3 report: the recommendation, the evidence at the time, the choice and an optional one-line override reason; `guardian forget` deletes an entry. Nothing about the person is stored. `assumptions.jsonl` is the assumption register: ASSUMPTION lines exported by `decide check` and entries added with `guardian assume add`, with impact, how to verify, a re-evaluation trigger and a status. `research/<question>.jsonl` holds a research question, the decision record it serves, its options, criteria, critical unknowns and stop condition, and each source with what it changed. |
| Sends | `api.github.com` | Through `gh`, only when it is installed and logged in: the state of the pull request named in a task, and your open pull requests for the session line. Code is never uploaded. |
| Sends | `127.0.0.1` | One request to your own app on the port a `runtime` check declares, after starting it or finding it running. Nothing goes past this machine. |
| Sends | `registry.npmjs.org`, `pypi.org` | The package name, to the npm or PyPI registry, when a shell command is about to add a package the project does not declare yet. Never with `FINITEMONKEY_OFFLINE=1`. |
| Sends | `api.osv.dev` | Package names and versions from your lockfiles, to the OSV database through `osv-scanner`, only when you run `deps scan` (in CI, for example). Never from a hook. |
| Sends | `api.github.com`, `api.stripe.com`, `api.openai.com`, `api.anthropic.com`, `api.digitalocean.com`, `api.cloudflare.com`, `api.asaas.com` | Through `curl`, only when you run `finitemonkey secrets live <provider> --env <VARIABLE> --send` yourself: one request with that key to the provider's API to see whether it still works. Off by default, never run by a hook, and the host is printed before anything is sent. |
| Sends | `deploy.version_url` | Through `curl`, only when `deploy.version_url` is set in `.finitemonkey/config.yml`: a GET to that URL after a push, to read which commit is live. With `deploy.environment`, the same question goes to GitHub deployments through `gh`. |
| Sends | `hosts.local.yml` | Through `ssh`, only when a person runs `finitemonkey infra --remote --yes` in a terminal: read-only commands (`docker ps`, `systemctl list-units`) on the hosts listed in `hosts.local.yml`. Never from a hook or an agent. |
| Sends | `headers.url` | Through `curl`, only when `headers.url` is set in `.finitemonkey/config.yml` and a task contract has the `headers` check: one GET per configured route, to read the security headers of the real response. Without it, the headers come from the app `look` already started on 127.0.0.1. |
| Sends | `hosts.local.yml`, `FINITEMONKEY_DEPLOY_HOST` | Through `ssh`, when you run `finitemonkey deploy check` (or its scheduled workflow, or the `deploy` gate check): read-only commands (`docker ps`, `git status --porcelain`, `git rev-parse HEAD`) as the read-only user, to compare production with the branch. With `--issue`, one GitHub issue is opened or commented through `gh`. |
<!-- generated:footprint:end -->
