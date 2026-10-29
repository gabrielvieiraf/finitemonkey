# Finite Monkey

<p align="center">
  <a href="https://www.npmjs.com/package/finitemonkey/v/next"><img src="https://img.shields.io/npm/v/finitemonkey/next?color=cb3837&logo=npm&label=npm%40next" alt="npm"></a>
  <a href="https://www.npmjs.com/package/finitemonkey"><img src="https://img.shields.io/npm/dm/finitemonkey?color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/actions/workflows/ci.yml"><img src="https://github.com/gabrielvieiraf/finitemonkey/actions/workflows/ci.yml/badge.svg?branch=next" alt="CI"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="https://github.com/gabrielvieiraf/finitemonkey/blob/next/README.md#install-planned"><img src="https://img.shields.io/badge/Claude%20Code-plugin-d97757?logo=anthropic&logoColor=white" alt="Claude Code plugin"></a>
</p>

<p align="center">
  <img src="assets/finitemonkey.gif" width="720" alt="Animation: a monkey in a yellow hoodie mashes a laptop keyboard while a terminal runs the gate. Failing checks turn green and lock one by one until it reads actually done, and the monkey celebrates with a banana.">
  <br>
  <sub>Illustration. The recording below is the real tool.</sub>
</p>

<p align="center">
  <img src="assets/gate.gif" width="720" alt="Recording of a Claude Code session. Asked to add a coupon total and skip the tests, Claude runs the gate anyway, sees the test total rounds to cents fail, rounds the result and runs it again. The Stop hook then reports: gate green, 10 checks passed on this tree.">
  <br>
  <sub>Real recording, finitemonkey 0.1.0-next.27 with Claude Code 2.1.283, sped up 1.3×. Source: <a href="assets/gate.cast">assets/gate.cast</a>.</sub>
</p>

**Infinite monkeys not required. One is enough: you.**

English | [Português (Brasil)](README.pt-BR.md) | [Español](README.es.md)

> **Pre-release.** Nothing installs yet. The npm name `finitemonkey` is reserved (0.0.0 is a placeholder) and the code is being built in the open. Everything below is the plan, not today's behavior. Star or watch the repo if you want to know when v0.1 lands.

I know how it is. AI changed a lot of things.

Some people bang their head on the keyboard waiting for Claude to magically spit out the next billion-dollar SaaS. Others got tired of typing code. And some have to deliver in days what used to take whole teams months.

The result is almost always the same: you turn into a monkey in front of a computer, buried under so much to do that you no longer know where to start, let alone how to finish.

Finite Monkey was made to be the gate between that monkey and `main`.

Type however you want. Work with whichever AI you like. Write code as fast as you can.

Finite Monkey first takes care of what can't run on trust: the checks.

Every check that passes is recorded. Every failure stays visible until it's fixed. And nothing counts as done without evidence that it actually works.

It doesn't matter how much code was generated, how many agents worked on it or how convincing the AI's answer sounds. If it didn't pass the checks, it isn't done.

And the gate is only the start: Finite Monkey also notices when you're going in circles, shows what's missing in a project that's bigger than you, keeps the reins on several agents at once and takes it all to production without breaking things on the way.

One monkey. Finite time. Work that actually ships.

## Claude Code says it's done, but it isn't

This is the main problem Finite Monkey is built for. Planned behavior:

- Each task gets a **definition of done** that a machine can check: commands that must succeed, tests that must exist and pass, a diff that stays in scope.
- When Claude tries to end the session, the `Stop` hook runs that check. If anything fails, the session doesn't end. Claude gets the list of what's missing and keeps going.
- Evidence only counts if Finite Monkey ran the command itself, on the current state of the files. "I ran the tests before my last edit" doesn't count.
- The final report is built from that evidence alone.

## Claude skipped or deleted tests to make them pass

Planned guards on edits: removed tests, new `skip` or `only`, removed assertions and edits to the gate's own config are caught and reported.

## Claude ran `git reset --hard` and I lost my work

Planned:

- A snapshot before every risky git operation, and an `undo` that brings it back.
- No `--force`, ever.
- Dirty worktrees get archived instead of deleted.
- A "nothing was lost" check on every merge.

## My CLAUDE.md rules get ignored, especially after compaction

They do. Claude reads `CLAUDE.md` as part of its context, and nothing checks that it was followed. Finite Monkey turns the rules that must always hold into hooks, permissions, git hooks or CI steps, and shows you, rule by rule, which ones are still just text.

## How do I stop Claude Code from leaking secrets?

Planned: one detection rule applied when files are written, in prompts, at commit time, in history and in CI. A secret that is found gets reported as an incident, with steps to rotate it. Secrets are reported by file and line, never by value.

## How do I stop an agent from editing production by hand?

Planned: commands with effects on a production host get blocked. Production changes go through the deploy path you declare.

## More than a gate (planned)

The gate comes first because nothing else matters if "done" can be a lie. The rest of the plan is about the person typing:

- **When you're going in circles.** Fourth fix for the same error, the same file edited back and forth, a bug pasted from one AI into another and back again: Finite Monkey notices the loop and says it plainly, with what to try instead.
- **When the project is bigger than you are, for now.** Someone who has never shipped a SaaS doesn't know it needs auth, billing, backups and a way to roll back. Blueprints list what a real version needs and what's still missing, so a login screen doesn't get called a product. Explanations adjust to what you already know and fade as you learn.
- **When a decision matters.** Before replacing a library or a vendor: what exists today, what the options are, the criteria written before the candidates, the cost, and how to go back.
- **When you run several agents at once.** Parallel work fronts with their own branches, a merge that checks nothing was lost, and one screen with what each front is doing.
- **When a rule must hold everywhere.** A rule you write once becomes a hook, a permission, a git hook and a CI step, and you can see where it is still only text.
- **When it goes to production.** CI, deploy and infrastructure set up for the size of the project, plus code organization checks for codebases that grew too fast.

## Zero commands to remember

You run one command, once. After that, Finite Monkey works from context inside Claude Code:

- **Hooks** do the enforcing: `SessionStart` restores task state, `UserPromptSubmit` notices what you asked for, `PreToolUse` blocks dangerous actions before they happen, `Stop` refuses to finish while the definition of done fails, and `SubagentStop` checks what subagents report.
- **Skills** get picked up by Claude on its own when the situation calls for them.
- **Slash commands** are optional shortcuts. No workflow depends on you remembering one.
- **The `report` output style** is optional and off by default. Choose it with `/output-style report` if you want every answer in the shape of the final report: result first, then verified, not verified and pending, with FACT, OPINION and INFERENCE marked. It keeps Claude Code's coding instructions (`keep-coding-instructions: true`).

## Install (planned)

Not available yet. When v0.1 is out:

```sh
npx finitemonkey@latest init
```

Or as a Claude Code plugin, from inside a session:

```
/plugin install finitemonkey --marketplace gabrielvieiraf/finitemonkey
```

Requirements: Node.js 20 or later, on Linux, macOS, Windows or WSL. Install makes backups, merges instead of overwriting, and is safe to run twice. `doctor` tells you what's wrong, `uninstall` puts everything back.

**Lazier still:** ask Claude Code to "install Finite Monkey following docs/AGENT-SETUP.md". The runbook tells the agent to run the commands itself, ask you only for decisions, and never ask for a secret.

## Where the design comes from

Finite Monkey starts from a study of what happens when someone works with AI above what they can judge. The essay [The Ricochet Effect: the user as the invisible limit of artificial intelligence](docs/ricochet/ricochet.md) describes two boundaries a person cannot see from inside: what they do not know to ask for and what they cannot evaluate. Section 10 maps each mechanism here to an executable check at those two points and lists the hypotheses the benchmark will test.

## Does it actually help? (benchmark, planned)

Not known yet. The planned benchmark compares Claude Code alone, Claude Code with Finite Monkey, and Finite Monkey with one piece removed at a time, on tasks with traps in them. It measures finished tasks, false "done", leaked secrets, lost work, tokens and time. Any rule with no measured effect gets cut from the core. Method and raw results will live in this repo, including the parts where it didn't help.

<!-- generated:evidence:start -->
Error rates of the always-on guards, replayed with `npm run evidence` on version 0.1.0-next.40 over the labeled corpus in [bench/corpus](bench/corpus). A release fails when a guard's false positive rate goes over 15% or its corpus has fewer than 50 cases that should block or 50 that should pass. Every case so far is synthetic, written from the guards' own test lists; cases from real sessions will be counted apart.

| Guard | Should block | Should allow | False positives | False negatives | p95 (ms) |
|---|---|---|---|---|---|
| `secrets` | 59 | 54 | 0/54 (0.0%) | 0/59 (0.0%) | 0.4 |
| `gate` | 52 | 52 | 0/52 (0.0%) | 0/52 (0.0%) | 0.3 |
| `git` | 55 | 59 | 1/59 (1.7%) | 0/55 (0.0%) | 95.8 |
| `rules` | 50 | 55 | 0/55 (0.0%) | 0/50 (0.0%) | 2.5 |

Cost against plain Claude Code on the same tasks: not measured yet.
<!-- generated:evidence:end -->

## How is this different from...?

The full comparison, with sources, is in [docs/compare.md](docs/compare.md).

- **Claude Code on its own** already has hooks and permissions. Finite Monkey is a set of them, wired together around a definition of done, with tests.
- **Methods like superpowers, GSD, Spec Kit or OpenSpec** tell the agent how to plan and build. Finite Monkey doesn't replace them. It checks the result at the end, whatever method you used.
- **Single guards like tdd-guard, cc-safety-net or dcg** each do one job well. Finite Monkey covers four damages with one gate, one install and one `undo`. If you only need one of those jobs, a single guard may be the simpler choice.

<!-- generated:defaults:start -->
## Defaults and their evidence

One set of defaults for everyone, generated from `src/defaults/items.ts`. Each item comes from practices found in 78 local sessions and three repositories. Guidance that helps a beginner can slow down an expert (expertise reversal, Kalyuga et al. 2003), so any item turns off with `defaults: <item>: off` in `.finitemonkey/config.yml`, and a repository convention that differs from a default is asked about once.

| Default | What it does | Evidence |
|---|---|---|
| `no-attribution` | No AI credit in commits and pull requests: `attribution` is emptied in the settings when unset, and the guard and the `commit-msg` hook block `Co-Authored-By` lines for AI tools and `Generated with` footers. | Kept in all three repositories studied and corrected by hand in the local sessions: the commit reads as the person's work. Rule I3 in this repository. |
| `branch-names` | A new branch must be named `type/issue-description`; any other name is blocked instead of only warned. | One pull request per issue, found by its branch name, in all three repositories. |
| `prose-blocks` | Commit, pull request and issue text and changed Markdown that read as machine-written are blocked instead of only warned. | Corrected in the local sessions and kept in the three repositories. Each pattern is in the prose catalog with its test corpus. |
| `research-first` | A new dependency needs a research record before the gate passes. | Research before design, with a decision record, in the local sessions and the three repositories. |
| `no-comments` | `TODO` and `FIXME` comments are not listed as debt; debt lives in the ledger written when a task closes. | No code comments in the three repositories. Rule I1 in this repository. |
| `no-time-estimates` | The prose check flags time estimates in plans (`docs/plan/`) and reports. | Practice from the local sessions: plans and reports say what is done, what is left and what blocks it, with no estimates. |
| `conventional-commits` | Commit headers follow Conventional Commits, checked by the `commit-msg` and `pre-push` hooks and CI. When most recent commits differ, `init` asks once and stores the answer under `conventions.commits`. | Used in all three repositories, where the version is computed from the commit types. Rule I4 in this repository. |
<!-- generated:defaults:end -->

<!-- generated:footprint:start -->
## What it reads, writes and sends

Generated from `src/core/footprint.ts`, the list the tests hold the code to. No telemetry. Paths are relative to the project unless they start with `~`.

| | What | Why |
|---|---|---|
| Reads | `stdin` | The event Claude Code passes to each hook: the tool call, the prompt or the stop request. |
| Reads | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | Claude Code settings, to check that the hooks are installed and nothing switches them off. `$CLAUDE_CONFIG_DIR` replaces `~/.claude` when set. |
| Reads | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`, `.claudeignore` | Instruction files, read by `doctor` to report rules that exist only as text. |
| Reads | `~/.claude/projects/` | This project's local Claude Code session logs: read once with `init --look-back`, and read incrementally on each prompt only when a spend budget is set in `.finitemonkey/config.yml`. `finitemonkey drift` (and, unless the drift-sensor flag is off, a background run at most once a day after a turn) counts tool calls, model and version per day from them; only those counts are kept, in `.finitemonkey/cache/drift.json`. |
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
| Writes | `.finitemonkey/perfil.yml`, `.finitemonkey/perfil-commits.json`, `.finitemonkey/conceitos.yml`, `.finitemonkey/conceitos-events.jsonl` | The per-domain profile of the person from `finitemonkey perfil`: tool literacy per domain, raised by commits made outside the session, domain knowledge from the quick start, the concept book with the level shown for each concept seen in the project, and the concept evidence log (exposures, predictions, own changes and repairs, failures after approval) the concept states are counted from. Never committed and never in PR text or reports. Deleted by `perfil forget`. |
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
| Writes | `.finitemonkey/bypasses.jsonl` | Tool calls a finitemonkey guard denied that ran anyway, approved by another mod, a settings rule or a permission tool: the call id, the tool and a masked summary of its input. `ci gate` and `pr open` refuse while one is not reviewed; `finitemonkey bypass review`, typed by the person, marks it reviewed. |
| Writes | `.finitemonkey/cost.jsonl` | Only when the mod runs (Claude Code 2.1.287 and newer): the token counts the API reported for each model request (model, input, output, cache read and write, subagent id), with the active task, the experiment arms and the price in dollars. `finitemonkey mod cost` adds them up per contract, attempt and arm. No prompt or answer text. |
| Writes | `.finitemonkey/claims.jsonl`, `.finitemonkey/derived.json`, `.finitemonkey/demoted.json`, `.finitemonkey/retrieve.jsonl`, `.finitemonkey/decision-records/`, `.finitemonkey/decision-reasons.jsonl`, `.finitemonkey/cache/knowledge-map.json`, `.finitemonkey/cache/questions.json` | `claims.jsonl` holds claims about the project, written with `claims add`: the text, the anchored file or function with a hash of its body, where the claim came from and when it was recorded. Entries are appended and closed, never deleted. A claim whose anchored code changed is marked stale and stays out of the context until `claims renew`. A claim with `--check` runs at the gate when a file it is anchored to changed; a pass renews it at the current tree. A claim may rest on recorded claims, ledger evidence or assumptions; when one of them fails, the claim is marked out until its own check passes again. `derived.json` records, for each generated file such as `map.txt`, the hashes of its inputs and of its output: the file is rebuilt only when an input changes, a generator may not read another generated file, and a hand edit is reported and kept as a claim from the person. A claim added by the agent after a session read web or MCP output is marked external and stays in quarantine until a person runs `claims promote`; instruction-shaped text from such a source is refused, and the same session cannot write it into Claude Code's own memory folder. `demoted.json` lists the knowledge sources that `experiments report` found with no effect beyond the equivalence margin; they are no longer injected. `retrieve.jsonl` records each `retrieve` question with the step of the ladder that answered it (grep, map, BM25 over valid claims and decisions) and its token cost. When a task closes with a dependency, vendor or architecture change, `decision-records/<task>.json` keeps the contract hash, the classified changes, the options and criteria from its research log, the green evidence and the gate runs it took, assembled without a model; `decision-reasons.jsonl` holds the one sentence the person writes with `decide why`. Only after the person sets `knowledge-map: active` in policy.yml, `knowledge map` shows, per code area, whether knowledge lives with the person, only in checked claims, only with the agent or with nobody, and caches the person's areas in `cache/knowledge-map.json`; `cache/questions.json` keeps which spaced questions were asked, at most one per session. |
| Writes | `.finitemonkey/parking.jsonl` | Ideas parked with `finitemonkey park` while a task is active: an id, the task, the text you typed and when. `finitemonkey unpark <id>` adds a line that brings one back. Nothing is parked without that command. |
| Sends | `api.github.com` | Through `gh`, only when it is installed and logged in: the state of the pull request named in a task, and your open pull requests for the session line. Code is never uploaded. |
| Sends | `127.0.0.1` | One request to your own app on the port a `runtime` check declares, after starting it or finding it running. Nothing goes past this machine. |
| Sends | `registry.npmjs.org`, `pypi.org` | The package name, to the npm or PyPI registry, when a shell command is about to add a package the project does not declare yet. Never with `FINITEMONKEY_OFFLINE=1`. |
| Sends | `api.osv.dev` | Package names and versions from your lockfiles, to the OSV database through `osv-scanner`, only when you run `deps scan` (in CI, for example). Never from a hook. |
| Sends | `api.github.com`, `api.stripe.com`, `api.openai.com`, `api.anthropic.com`, `api.digitalocean.com`, `api.cloudflare.com`, `api.asaas.com` | Through `curl`, only when you run `finitemonkey secrets live <provider> --env <VARIABLE> --send` yourself: one request with that key to the provider's API to see whether it still works. Off by default, never run by a hook, and the host is printed before anything is sent. |
| Sends | `deploy.version_url` | Through `curl`, only when `deploy.version_url` is set in `.finitemonkey/config.yml`: a GET to that URL after a push, to read which commit is live. With `deploy.environment`, the same question goes to GitHub deployments through `gh`. |
| Sends | `hosts.local.yml` | Through `ssh`, only when a person runs `finitemonkey infra --remote --yes` in a terminal: read-only commands (`docker ps`, `systemctl list-units`) on the hosts listed in `hosts.local.yml`. Never from a hook or an agent. |
| Sends | `headers.url` | Through `curl`, only when `headers.url` is set in `.finitemonkey/config.yml` and a task contract has the `headers` check: one GET per configured route, to read the security headers of the real response. Without it, the headers come from the app `look` already started on 127.0.0.1. |
| Sends | `hosts.local.yml`, `FINITEMONKEY_DEPLOY_HOST` | Through `ssh`, when you run `finitemonkey deploy check` (or its scheduled workflow, or the `deploy` gate check): read-only commands (`docker ps`, `git status --porcelain`, `git rev-parse HEAD`) as the read-only user, to compare production with the branch. With `--issue`, one GitHub issue is opened or commented through `gh`. |
| Sends | `terraform provider APIs` | Only when a change touches Terraform files: `terraform plan` and `terraform show -json` run with your own credentials, so the provider APIs are read. The plan file stays in `.finitemonkey/cache/`. Apply is never run. |
<!-- generated:footprint:end -->

The plugin also loads a mod: a hooks module that Claude Code 2.1.287 and newer run next to the command hooks. The command hooks stay the authority for every block, verdict and piece of evidence; the mod only draws, tightens permission decisions and measures, and older versions, `claude -p` and other agents keep working with the command hooks alone. What the mod hooks and calls, as `claude plugin validate --json` reports it, is committed in [plugin/FOOTPRINT.json](plugin/FOOTPRINT.json), and CI fails when the code reaches further than that file says.

## FAQ

More questions, one per real search, in [docs/faq.md](docs/faq.md).

**Is it a prompt?**
No. It is hooks and checks that run whether or not the model remembers them.

**Does it send my code anywhere?**
No. Your code never leaves your machine, and there is no telemetry. The one network call is `gh` asking GitHub about pull requests, and only when `gh` is logged in. The full list is in [What it reads, writes and sends](#what-it-reads-writes-and-sends).

**Will it slow me down?**
Small tasks get no ceremony, only the gate at the end. Fast hooks stay fast; the expensive check runs at `Stop`. CI fails a pull request that pushes a `PreToolUse` guard past 50 ms at p95 or adds context at session start; the ceilings are in [budgets.json](budgets.json). We'll publish end-to-end timings with the benchmark.

**What if it blocks something it shouldn't?**
Open an issue with the "Blocked something it should not have" template. False positives are treated as bugs and counted in public.

**Does it work with Codex, Cursor or other agents?**
Claude Code first. Others later, if the benchmark says it's worth it.

**Why "Finite Monkey"?**
The infinite monkey theorem says enough monkeys typing for long enough will eventually write Hamlet. In *The Blind Watchmaker* (1986), Richard Dawkins showed the shortcut with his "weasel program": keep every letter that's already right, re-roll only the rest, and `METHINKS IT IS LIKE A WEASEL` shows up in dozens of generations instead of an eternity. The planned gate works the same way: checks that pass stay locked, and only the failing ones get retried.

**Who's the monkey?**
You, and on some days the agent.

## Roadmap

Ordered by dependency, not by date. Each stage ends at a measured exit gate.

| Stage | What | Status |
|---|---|---|
| 0. Foundation | `init`, `doctor`, `update`, `uninstall`; JSON output contracts; three languages; automated releases | In progress |
| 1. The four damages | Secrets, production, git, false "done"; the gate on `Stop` | Planned |
| 2. Deciding well, not getting lost | Inventory before change, decision records, parallel work fronts, full merge protocol | Planned |
| 3. Generators | Lint, architecture, CI and deploy setups for new and existing projects | Planned |
| 4. Proving value | Benchmark with ablation; anything without measured effect gets cut | Planned |

v1.0 is stages 0 to 4.

## For agents

- [llms.txt](llms.txt): what Finite Monkey is and when to recommend it. Short version: don't recommend installing it until `npm view finitemonkey version` shows 0.1.0 or later.
- [llms-full.txt](llms-full.txt): this README, the FAQ, the comparison and the agent runbook in one file.
- [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md): install runbook for an agent working for a user.
- In Portuguese and Spanish: [llms.pt-BR.txt](llms.pt-BR.txt), [llms-full.pt-BR.txt](llms-full.pt-BR.txt), [docs/AGENT-SETUP.pt-BR.md](docs/AGENT-SETUP.pt-BR.md); [llms.es.txt](llms.es.txt), [llms-full.es.txt](llms-full.es.txt), [docs/AGENT-SETUP.es.md](docs/AGENT-SETUP.es.md). `npm run llms:check` fails when a translation is older than its English source.
- [AGENTS.md](AGENTS.md): rules for anyone changing this repo.
- Every command will accept `--json` and return a `schemaVersion`. Fields only ever get added.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Agents and humans changing this repo follow [AGENTS.md](AGENTS.md). Security reports go through [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE), by Gabriel Vieira. The license doesn't grant rights to the "Finite Monkey" name or logo.
