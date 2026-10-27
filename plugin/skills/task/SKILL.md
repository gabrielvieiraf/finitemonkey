---
name: task
description: >-
  Use when starting non-trivial work (more than a one-line change, several files, a bug fix, a new screen or endpoint, anything the person will check later). Write the done contract before editing code, so "done" is something a machine can confirm.
when_to_use: >-
  Trigger phrases include implement, add a feature, fix this bug, refactor, implementa, corrige, cria a tela, arregla, agrega.
---

# Task: write the done contract first

Skip this for a question, a one-line fix or pure exploration.

1. Propose the contract and show it to the person in five lines or fewer: goal, size (S, M or L), paths in scope, and acceptance checks.
2. Create it with `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" task new --json` and follow its `next` field.
3. Before writing a helper, a hook or a service, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" map` and reuse what it lists. It prints one line per folder with its top-level definitions and is cached until the code changes.
4. For a build, a test suite or any command with long output, run it as `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" run -- <command>`: the full output goes to a file under `.finitemonkey/runs/`, and you get the `ERROR` lines, the exit code and the path. Read the file only when the summary is not enough.
5. Acceptance checks must be runnable: a command with an exit code, tests that must not shrink, a screen to look at, a git state. "Works" is not a check.

For an L task (a replacement, a rewrite, several modules): `task new --size L` creates `docs/plan/MASTER.md`. Write reports in `docs/plan/` with a "Text for the plan" section. To bring them in, run `plan consolidate` (it saves the previous master plan with its date and prints the texts), edit `MASTER.md` keeping its section order, then run `plan consolidate --done` and fix what `plan check` lists. Never import `docs/plan/` files into `AGENTS.md` or `CLAUDE.md`.

Example of the shape the contract takes:

```yaml
id: 142-checkout-pix
goal: Member pays with Pix and sees the confirmation
size: M
scope:
  paths: [src/page/checkout/**, src/api/schemas/orders.ts]
acceptance:
  - { id: A1, check: command, run: npm run check }
  - { id: A2, check: tests, run: npm test -- checkout }
```

If the command answers `unknown_command` or `not_implemented`, tell the person in one line that contracts are not in this version yet and keep the five-line summary in your reply instead.
