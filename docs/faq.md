# Finite Monkey FAQ

English | [Português (Brasil)](faq.pt-BR.md) | [Español](faq.es.md)

> **Early versions.** Finite Monkey installs through npm's `next` channel (`npx finitemonkey@next init`); there is no stable version yet. Every answer below says what you can do today with Claude Code alone, and what Finite Monkey adds. Whether it helps is not measured yet: the benchmark has not been run.

Each question is a search people actually type, taken from issue titles in [anthropics/claude-code](https://github.com/anthropics/claude-code/issues) and from Hacker News threads, checked on 2026-10-25.

## Why does Claude Code say it's done when it isn't?

Because "done" is a sentence the model writes, and nothing checks it by default. Users report this often, for example [anthropics/claude-code#60177](https://github.com/anthropics/claude-code/issues/60177) ("Claude marks tasks done without testing").

- **Today:** Claude Code has a `Stop` hook. A hook you write can refuse to let the session end and tell Claude why. It works, but you write and maintain the check yourself.
- **In Finite Monkey:** a definition of done per task (commands, tests, scope) that the `Stop` hook runs on the current files. If it fails, Claude gets the list of what's missing and keeps working. The final report comes from that evidence, not from the agent's summary.

## How do I stop Claude Code from lying about tests?

Have something other than the agent produce the test result. A line like "all tests pass" in the chat, or a progress file the agent edits, can say anything. A test run that a hook starts on the current files reports what actually happened.

- **Today:** a `Stop` hook that runs your test command and blocks on failure. Watch out for checks that accept any command that exits 0, such as `echo "tests passed"`.
- **In Finite Monkey:** evidence only counts when Finite Monkey ran the command itself, on the current state of the tree. Trivial commands and test runs with zero tests are rejected as evidence.

## Claude Code deleted or skipped my tests to make them pass. How do I prevent it?

Look at the diff as well as the test result: after a test is removed or marked `skip`, the run still reports green.

- **Today:** review diffs to test files, and add a CI step that fails when the test count drops or when `.skip` or `.only` appear.
- **In Finite Monkey:** a tests guard that catches removed tests, new `skip` or `only`, removed assertions and edits to the gate's own config, including when the change comes through a shell command instead of an edit.

## Claude Code ran `git reset --hard` and I lost my work. How do I prevent it?

Block destructive git commands before they run, and keep a snapshot of what would be lost. This is a common report, for example [anthropics/claude-code#7232](https://github.com/anthropics/claude-code/issues/7232) and [#34327](https://github.com/anthropics/claude-code/issues/34327).

- **Today:** add permission deny rules for destructive git commands in `.claude/settings.json`, or a `PreToolUse` hook that blocks them. Commits you already made can usually be found again with `git reflog`; uncommitted edits usually cannot.
- **In Finite Monkey:** a snapshot before every risky git operation, an `undo` that restores it, dirty worktrees archived instead of deleted, and a "nothing was lost" check on every merge.

## How do I prevent Claude Code from force pushing?

Block it in two places: on your machine and on the server.

- **Today:** a permission deny rule or a `PreToolUse` hook for `git push --force` and its variants, plus branch protection or a ruleset on GitHub that forbids force pushes to shared branches. The server-side rule is the one that still holds if everything local is bypassed.
- **In Finite Monkey:** it never force pushes and blocks `--force` and its variants. It also shows which of your git rules are enforced by a mechanism and which are only text.

## Why does Claude Code ignore CLAUDE.md, especially after compaction?

Because `CLAUDE.md` is text loaded into the model's context, and nothing executes or checks it. The model weighs it against everything else in the conversation and can drop it. See [anthropics/claude-code#7777](https://github.com/anthropics/claude-code/issues/7777) and [#19471](https://github.com/anthropics/claude-code/issues/19471) ("CLAUDE.md instructions completely ignored after context compaction").

- **Today:** keep `CLAUDE.md` short, and move every rule that must always hold out of prose and into a hook, a permission rule, a git hook or a CI step.
- **In Finite Monkey:** it does that move for the rules it knows, and shows you, rule by rule, which ones are enforced and which are still just text.

## How do I make CLAUDE.md rules actually enforced?

Turn each rule into the cheapest mechanism that can check it. A rule like "never commit `.env`" becomes a pre-commit hook and a CI scan. "Run the tests before saying done" becomes a `Stop` hook. "Don't touch production" becomes a blocked command.

- **Today:** Claude Code hooks (`PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit` and others), permission rules, git hooks and CI. Each one runs whether or not the model remembers the rule.
- **In Finite Monkey:** it ships these as one tested set, installed with backups and removable with `uninstall`.

## How do I stop Claude Code from leaking API keys or secrets in commits?

Scan for secrets at more than one point, because a key can leak through a written file, a prompt, a commit, history or a pull request. [anthropics/claude-code#2142](https://github.com/anthropics/claude-code/issues/2142) is one report of API keys reaching version control.

- **Today:** a pre-commit secret scanner (gitleaks is a common choice), GitHub secret scanning with push protection, and a `PreToolUse` hook or deny rule that keeps the agent from reading `.env` files.
- **In Finite Monkey:** one detection rule applied when files are written, in prompts, at commit time, in history and in CI. A secret found is treated as an incident to rotate. Secrets are reported by file and line, never by value. It reduces the risk; it cannot promise that nothing ever leaks.

## How do I stop an AI agent from touching a production server?

Give the agent no direct path to production, and block the commands that would create one.

- **Today:** don't keep production credentials where the agent's shell can use them, deploy only through CI, and block remote shell commands to production hosts with a hook or a permission rule.
- **In Finite Monkey:** commands with effects on a declared production host get blocked. Production changes go through the deploy path you declared, and nowhere else.

## What is a definition of done for coding agents?

A list of conditions a machine can check before the agent is allowed to call the work finished: commands that must succeed, tests that must exist and pass, files that must or must not change.

- **Today:** you can write one by hand as a script and call it from a `Stop` hook.
- **In Finite Monkey:** it creates one per task, runs it at `Stop`, ties the evidence to the current state of the files, and keeps ceremony at zero for small tasks.

## Can a Claude Code Stop hook verify tests before finishing?

Yes. A `Stop` hook can run your test command and, if it fails, block the stop with a reason that Claude reads and acts on. Two details matter: the check has to run on the current files, not trust an earlier run, and it should not give up the second time it is asked to stop.

- **In Finite Monkey:** the gate is built on exactly this hook, with the evidence rules above and a final "not finished" report instead of looping forever.

## Is there a safety plugin or guardrails for Claude Code?

Yes, several, and some are good at one job. tdd-guard enforces test-first edits; cc-safety-net and dcg block destructive shell and git commands. Methods like Superpowers, GSD and Spec Kit add process. The [comparison page](compare.md) lists what each one enforces by mechanism and what it leaves to prose, with sources.

- **In Finite Monkey:** it covers four damages (false "done", leaked secrets, hand edits to production, lost git work) with one gate, one install and one `undo`. Whether that beats a single guard for you is what the benchmark is for, and it has not been run yet.

## Does it work with tools that switch Claude Code accounts when a limit hits?

Yes, if the switcher reads a hold file. A supervisor that restarts Claude Code on another account can cut the gate in the middle of a `Stop`, and the resumed session waits for you with the work half checked.

To opt in, add `supervisor:` with `enabled: true` to `.finitemonkey/config.yml`, and have the supervisor set `FINITEMONKEY_HOLD_DIR` to a directory it watches. While the gate runs or holds the stop, Finite Monkey keeps `<session>.hold.json` there, with an `until` time; the supervisor should not switch while `until` is in the future. The file expires on its own (10 minutes for a run, 15 for a held stop) and is deleted when the gate passes. When the session resumes on the new account, `SessionStart` tells Claude what the gate was waiting for and runs the gate again. Resume messages that start with `[supervisor]` are not taken as yours, and a `usage.json` in the same directory shows up in `finitemonkey gain`.
