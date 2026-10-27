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

## Does it actually help? (benchmark, planned)

Not known yet. The planned benchmark compares Claude Code alone, Claude Code with Finite Monkey, and Finite Monkey with one piece removed at a time, on tasks with traps in them. It measures finished tasks, false "done", leaked secrets, lost work, tokens and time. Any rule with no measured effect gets cut from the core. Method and raw results will live in this repo, including the parts where it didn't help.

## How is this different from...?

The full comparison, with sources, is in [docs/compare.md](docs/compare.md).

- **Claude Code on its own** already has hooks and permissions. Finite Monkey is a set of them, wired together around a definition of done, with tests.
- **Methods like superpowers, GSD, Spec Kit or OpenSpec** tell the agent how to plan and build. Finite Monkey doesn't replace them. It checks the result at the end, whatever method you used.
- **Single guards like tdd-guard, cc-safety-net or dcg** each do one job well. Finite Monkey covers four damages with one gate, one install and one `undo`. If you only need one of those jobs, a single guard may be the simpler choice.

<!-- generated:footprint:start -->
## What it reads, writes and sends

Generated from `src/core/footprint.ts`, the list the tests hold the code to. No telemetry. Paths are relative to the project unless they start with `~`.

| | What | Why |
|---|---|---|
| Reads | `stdin` | The event Claude Code passes to each hook: the tool call, the prompt or the stop request. |
| Reads | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | Claude Code settings, to check that the hooks are installed and nothing switches them off. `$CLAUDE_CONFIG_DIR` replaces `~/.claude` when set. |
| Reads | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/`, `.claudeignore` | Instruction files, read by `doctor` to report rules that exist only as text. |
| Reads | `~/.claude/projects/` | This project's local Claude Code session logs: read once with `init --look-back`, and read incrementally on each prompt only when a spend budget is set in `.finitemonkey/config.yml`. |
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
| Writes | `.finitemonkey/pr/` | Who accepted files outside the task scope in `pr open`, when and why, one file per branch. |
| Writes | `.git/finitemonkey/worktrees.yml`, `.git/finitemonkey/merges/`, `.git/info/exclude`, `.claude/worktrees/`, `~/.finitemonkey/worktrees/`, `~/.finitemonkey/archive/`, `refs/finitemonkey/archive/` | The worktree registry and merge reports in the git common dir (never committed), the local exclude line for `.claude/worktrees/`, and worktrees created by `wt new`; repos on `/mnt/<drive>` or a synced folder get theirs under `~/.finitemonkey/worktrees/`. `wt archive` saves a worktree into `refs/finitemonkey/archive/` and copies ignored files that are not secrets to `~/.finitemonkey/archive/`. |
| Writes | `.finitemonkey/look/` | Screen captures, the contact sheet and the JSON summary that `look` writes per tree hash. |
| Writes | `.finitemonkey/spend.json`, `.finitemonkey/spend-reconcile.jsonl` | Agent spend estimated from the local session logs, per task, day and month, and the differences found by `cost reconcile`. |
| Writes | `docs/plan/` | Plan documents under `docs/plan/`: the inventory of what the code does today, decision records, research records, cost models, the master plan from the first L task and the copy of it kept before each consolidation. |
| Writes | `.finitemonkey/map.txt`, `.finitemonkey/reuse.json` | The code map from `finitemonkey map`: one line per folder with its top-level definitions, cached by tree hash, and the log of reuse warnings with whether each one led to reuse. |
| Writes | `.finitemonkey/review/`, `.claude/agents/verifier.md` | The review round count used by `review packet`, and, only when `review.playwright: true` is set in the config, a verifier agent with the Playwright MCP. |
| Sends | `api.github.com` | Through `gh`, only when it is installed and logged in: the state of the pull request named in a task, and your open pull requests for the session line. Code is never uploaded. |
| Sends | `127.0.0.1` | One request to your own app on the port a `runtime` check declares, after starting it or finding it running. Nothing goes past this machine. |
| Sends | `registry.npmjs.org`, `pypi.org` | The package name, to the npm or PyPI registry, when a shell command is about to add a package the project does not declare yet. Never with `FINITEMONKEY_OFFLINE=1`. |
| Sends | `api.github.com`, `api.stripe.com`, `api.openai.com`, `api.anthropic.com`, `api.digitalocean.com`, `api.cloudflare.com`, `api.asaas.com` | Through `curl`, only when you run `finitemonkey secrets live <provider> --env <VARIABLE> --send` yourself: one request with that key to the provider's API to see whether it still works. Off by default, never run by a hook, and the host is printed before anything is sent. |
<!-- generated:footprint:end -->

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
