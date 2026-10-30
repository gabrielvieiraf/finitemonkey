# How Finite Monkey compares

English | [Português (Brasil)](compare.pt-BR.md) | [Español](compare.es.md)

> **Early versions.** Finite Monkey ships early versions on npm's `next` channel. What this page says about it describes what the code does, and none of it is **measured yet**: the benchmark has not been run. Everything said about the other projects is a fact you can check at the link next to it.

**Checked on 2026-10-25** by reading each project's code at the commit listed below. No third-party hook was executed. If something here is wrong or out of date, open an issue or a pull request and it will be corrected.

## Mechanism or prose

The question this page asks about every project is the same: when the model would rather skip a rule, what still holds?

- **Mechanism**: code that runs in the harness (a hook, a permission rule, a git hook, a CI step) and blocks or checks no matter what the model decides.
- **Prose**: text the model reads (a skill, a prompt, a `CLAUDE.md`) and may follow. Prose is often the right tool for planning, style and judgment. On its own it cannot show that something happened.

Most setups need both. Finite Monkey's scope is narrow: the few things that must always hold (verified done, tests not weakened, no leaked secrets, no lost git work, no hand edits to production) should be mechanism.

## At a glance

| Project | What it is | Strongest at | Mechanism | Left to the model |
|---|---|---|---|---|
| [Superpowers](https://github.com/obra/superpowers) | Skills library and development method | Planning before coding, test-first discipline, zero commands | One `SessionStart` hook; a `task-done` script that records only on exit 0 | Calling `task-done`, and every gate in the skills |
| [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | Multi-agent orchestration | Delegation, modes, status line | `Stop` hooks, a git guard with a shell parser, a read budget | Declaring completion (`/cancel`); git guard off outside autonomous modes |
| [GSD](https://github.com/open-gsd/gsd-core) | Spec and phase workflow with state in files | Work that survives `/clear`, planning | Guards on `.env` reads, on shrinking state files, on agent isolation | The verification verdict, written by an LLM agent |
| [Spec Kit](https://github.com/github/spec-kit) | Spec-driven development toolkit | Structure for medium and large changes, extensibility | Workflow `shell` steps; a native hook subsystem, not enabled by default | Extension hooks, test validation, "Converged" |
| [ECC](https://github.com/affaan-m/ECC) | Large catalog of skills, agents, commands and hooks | Breadth; a thorough `--no-verify` guard | `--no-verify` guard, lint config protection | `Stop` type check reports and exits 0; first-touch guard allows the retry |
| [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/ralph-loop) | Official plugin that keeps the agent iterating | Persistence on long tasks, simplicity | A `Stop` hook that re-feeds the prompt | The exit condition, a string the model writes |
| [tdd-guard](https://github.com/nizos/tdd-guard) | Test-first enforcement | One job, done with focus | Hook on edits that can block | The judgment of whether an edit is test-first (a model call) |
| [dcg](https://github.com/Dicklesworthstone/destructive_command_guard) | Destructive command guard | Coverage of dangerous commands, fails closed on timeout | `PreToolUse` block | n/a (not about done) |
| [cc-safety-net](https://github.com/kenryu42/cc-safety-net) | Destructive command guard | One job, quick install, `doctor` | `PreToolUse` block | n/a (not about done) |
| Finite Monkey | Gate around a definition of done | Not measured yet: early versions on `next` | Gate on `Stop`, guards on `PreToolUse`, git hooks, CI | Nothing on the four damages |

## Superpowers

Commit [`2ce8aa1`](https://github.com/obra/superpowers/tree/2ce8aa1) (v7.0.1).

**What it does well.** The skills trigger on their own, so there is nothing to remember. The brainstorming skill makes the agent read the project and ask before it codes, which is the effect users describe first. The test-first and debugging skills give the model a strong method.

**Mechanism.** One hook: `SessionStart` on `startup|clear|compact` ([`hooks/hooks.json`](https://github.com/obra/superpowers/blob/2ce8aa1/hooks/hooks.json)). The script [`skills/executing-plans/scripts/task-done`](https://github.com/obra/superpowers/blob/2ce8aa1/skills/executing-plans/scripts/task-done) runs the test command and writes a "Task N: complete" line only when it exits 0.

**Prose.** The gates are skill text, such as "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE" in [`verification-before-completion`](https://github.com/obra/superpowers/blob/2ce8aa1/skills/verification-before-completion/SKILL.md). The model decides whether to call `task-done`, and [obra/superpowers#2549](https://github.com/obra/superpowers/issues/2549) notes that a stand-in command such as `echo "tests passed"` is indistinguishable from a real test run.

**Where Finite Monkey differs.** The gate runs the check itself from a hook every time the agent tries to stop, and trivial commands do not count as evidence. It leaves planning to skills like these; an approved Superpowers design could become the input of a definition of done. Not measured yet.

## oh-my-claudecode

Commit [`5632614`](https://github.com/Yeachan-Heo/oh-my-claudecode/tree/5632614) (v5.7.14).

**What it does well.** Multi-agent orchestration with roles and modes, a status line users like, and a git guard with a real shell parser.

**Mechanism.** [`scripts/workflow-drift-guard.mjs`](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/5632614/scripts/workflow-drift-guard.mjs) on `Stop` blocks when the last message claims done and the diff added `.skip(`, `.only(` or placeholders. [`scripts/git-guardrails.mjs`](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/5632614/scripts/git-guardrails.mjs) blocks `git push`, `reset --hard`, `clean -f` and similar. A read budget denies very large unbounded reads.

**Where the model decides.** The drift guard lets the stop through when `stop_hook_active` is set (line 910), so it blocks once. The git guard is active only in the `ralph`, `autopilot`, `team` and `ultragoal` modes (line 38) or with an environment variable. In the persistent modes, completion is the model running `/cancel`.

**Where Finite Monkey differs.** The gate keeps blocking for as long as the definition of done fails, and the git guard is always on. Not measured yet.

## GSD

[`open-gsd/gsd-core`](https://github.com/open-gsd/gsd-core) at commit [`754e886`](https://github.com/open-gsd/gsd-core/tree/754e886) (v1.18.0). The original [`gsd-build/get-shit-done`](https://github.com/gsd-build/get-shit-done) is archived and points to it.

**What it does well.** State lives in files, so work continues after `/clear`. Planning and phases are the center of the product. It ships real blocking guards.

**Mechanism.** [`hooks/gsd-secret-read-guard.js`](https://github.com/open-gsd/gsd-core/blob/754e886/hooks/gsd-secret-read-guard.js) blocks reading `.env` and similar files through Read, Grep and Bash, and its header explains why a hook works better than `Read()` permission rules. [`hooks/gsd-write-guard.js`](https://github.com/open-gsd/gsd-core/blob/754e886/hooks/gsd-write-guard.js) blocks writes that shrink the roadmap or state files. An isolation guard denies executor agents without a worktree.

**Where the model decides.** Verification is an LLM agent ([`agents/gsd-verifier.md`](https://github.com/open-gsd/gsd-core/blob/754e886/agents/gsd-verifier.md)) that writes `VERIFICATION.md`, and the phase gate in [`src/phase.cts`](https://github.com/open-gsd/gsd-core/blob/754e886/src/phase.cts) reads the status that agent wrote.

**Where Finite Monkey differs.** The verdict comes from commands the gate ran on the current files. Not measured yet.

## Spec Kit

Commit [`67e0f72`](https://github.com/github/spec-kit/tree/67e0f72).

**What it does well.** A clear structure from spec to plan to tasks for medium and large changes, many integrations, and a small fixed context. Users praise its extensibility.

**Mechanism.** Workflow `shell` steps fail on a nonzero exit. An `events` subsystem can install native Claude Code hooks and pass their exit codes through; the built-in extensions do not enable it.

**Prose.** Extension hooks such as `after_implement` depend on the model invoking them: "mandatory extension hooks rely on the model invoking the hook skill" ([`src/specify_cli/integrations/claude/__init__.py`](https://github.com/github/spec-kit/blob/67e0f72/src/specify_cli/integrations/claude/__init__.py), lines 70 to 72). Test validation in the implement command is an instruction, and convergence is declared by the model. [github/spec-kit#1323](https://github.com/github/spec-kit/issues/1323) asks for a final quality gate.

**Where Finite Monkey differs.** The gate runs as a `Stop` handler and is also a command (`finitemonkey gate`) that a Spec Kit workflow `shell` step can run, and `finitemonkey task from-spec` proposes a definition of done from a `tasks.md` without changing it. Not measured yet.

## ECC (Everything Claude Code)

[`affaan-m/ECC`](https://github.com/affaan-m/ECC) at commit [`90606c8`](https://github.com/affaan-m/ECC/tree/90606c8) (v2.2.3).

**What it does well.** The broadest catalog in this list. Its `--no-verify` guard is the most thorough one read for this page: it also catches hook redirection through `core.hooksPath`, `include.path` and `includeIf`, and blocks when it cannot parse the command.

**Mechanism.** [`block-no-verify.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/block-no-verify.js) and [`config-protection.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/config-protection.js) block with exit code 2. Config protection covers linter and formatter configs and leaves test configs such as `vitest.config.ts` and `tsconfig.json` out on purpose (lines 111 to 115).

**Where the model decides.** [`stop-format-typecheck.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/stop-format-typecheck.js) runs on `Stop`, reports and exits 0, so it informs without blocking. [`gateguard-fact-force.js`](https://github.com/affaan-m/ECC/blob/90606c8/scripts/hooks/gateguard-fact-force.js) denies the first touch of a file and lets the retry pass (lines 1935 and 1936).

**Where Finite Monkey differs.** A small core with a context budget checked in CI, a `Stop` gate that blocks, and no guard that gives way on retry. Not measured yet.

## ralph-loop

Official plugin in [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/ralph-loop), commit `5826794`.

**What it does well.** It keeps the agent working on a long task instead of stopping early, with almost no setup.

**Mechanism.** A `Stop` hook ([`hooks/stop-hook.sh`](https://github.com/anthropics/claude-plugins-official/blob/5826794/plugins/ralph-loop/hooks/stop-hook.sh)) feeds the prompt back until a maximum number of iterations is reached (line 61).

**Where the model decides.** The loop ends when the model's last message contains `<promise>TEXT</promise>` matching the completion promise you set (lines 129 to 138). The hook's own message asks the model not to lie to exit.

**Where Finite Monkey differs.** The `Stop` gate keeps the agent working until the definition of done passes, and after its block limit ends with a "not finished" report. Not measured yet.

## tdd-guard

Commit [`108992d`](https://github.com/nizos/tdd-guard/tree/108992d).

**What it does well.** One job, done with focus: it blocks edits that skip the failing test first. The person turns it on and off by typing `tdd-guard on` or `tdd-guard off` ([`src/hooks/userPromptHandler.ts`](https://github.com/nizos/tdd-guard/blob/108992d/src/hooks/userPromptHandler.ts), lines 8 and 9), which keeps that switch in human hands.

**Mechanism and judgment.** The hook blocks for real. Whether an edit counts as test-first is decided by a model call on each edit.

**Where Finite Monkey differs.** It does not enforce test-first. It checks that tests were not removed, skipped or weakened, and that they pass on the final files. If test-first is what you want, tdd-guard is the more direct tool.

## dcg (destructive_command_guard)

Commit [`b33f3ef`](https://github.com/Dicklesworthstone/destructive_command_guard/tree/b33f3ef).

**What it does well.** Broad coverage of destructive commands, support for many agents, and a clear failure direction: an evaluation over 1000 ms returns an indeterminate decision, "never allow" ([`src/perf.rs`](https://github.com/Dicklesworthstone/destructive_command_guard/blob/b33f3ef/src/perf.rs), lines 800 to 812). Its maintainers track false positives in public, for example [#560](https://github.com/Dicklesworthstone/destructive_command_guard/issues/560).

**Where Finite Monkey differs.** dcg guards commands. Finite Monkey adds a snapshot and `undo` around risky git operations, and a done gate. If you only need a command guard, dcg is a focused choice.

## cc-safety-net

Commit [`71baf74`](https://github.com/kenryu42/cc-safety-net/tree/71baf74).

**What it does well.** It blocks `git reset --hard`, `git push --force`, `rm -rf` on dangerous targets and piped install scripts, even inside `bash -c` or `python -c` ([`README.md`](https://github.com/kenryu42/cc-safety-net/blob/71baf74/README.md), line 74). It installs in one line and has a `doctor`. When the hook was slow under `npx`, the maintainer moved to a bundled binary ([#16](https://github.com/kenryu42/cc-safety-net/issues/16)).

**Where Finite Monkey differs.** Same as dcg: the additions are snapshot and `undo`, and the done gate. For a command guard alone, cc-safety-net is the simpler install.

## Where Finite Monkey differs

None of this is **measured yet**: the benchmark has not been run.

- **Evidence from the gate's own runs.** Done means the gate ran the definition of done on the current files. A chat message, a progress file or a report written by an agent does not count.
- **Blocking until the checks pass.** It keeps blocking while the definition of done fails, and ends with a "not finished" report instead of looping forever.
- **Four damages in one install.** False "done", leaked secrets, hand edits to production and lost git work, with one `undo` for git.
- **Small fixed context.** Enforcement lives in hooks, which cost no tokens per turn, with a byte budget checked in CI.
- **Benchmark.** A public benchmark with ablation decides which rules stay. Its harness is built; it has not been run.

## Where they are ahead today

- They have stable releases and are used. Finite Monkey has only early versions on `next`.
- Superpowers, GSD and Spec Kit help decide what to build. Finite Monkey does not build that phase; it reads their output.
- Several of them work across many agents. Finite Monkey starts with Claude Code only.

## Also in this space

- [OpenSpec](https://github.com/Fission-AI/OpenSpec): spec-driven changes; [#1142](https://github.com/Fission-AI/OpenSpec/issues/1142) asks for quality gates as a first-class concept.
- [no-mistakes](https://github.com/kunchenguid/no-mistakes): review and tests before push, with commands read from the default branch instead of the pushed commit.
- [hookify](https://github.com/anthropics/claude-plugins-official/tree/5826794/plugins/hookify): official plugin that turns a sentence into a hook rule.
- On npm, `redpen-cli` ("A definition-of-done and verification layer for coding agents") and `@reneza/skillgate` ("Deterministic finish-line gates for AI coding agents") describe goals close to Finite Monkey's. They were not read in depth for this page.
