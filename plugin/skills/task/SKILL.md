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
2. Create it with `npx --yes --prefer-offline finitemonkey@0.0.0-development task new --json` and follow its `next` field.
3. Acceptance checks must be runnable: a command with an exit code, tests that must not shrink, a screen to look at, a git state. "Works" is not a check.

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
