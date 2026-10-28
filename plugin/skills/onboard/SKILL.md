---
name: onboard
description: >-
  Use when Finite Monkey is new in an existing project, or when the person asks which commands build, test, lint or typecheck it. Discovers the real commands by running them and lists the active risks without fixing them.
when_to_use: >-
  Trigger phrases include onboard, first run, existing project, which commands, projeto existente, primeiro uso, proyecto existente.
---

# Onboard: commands that really run

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" onboard --json`. It reads the manifests (package.json, Makefile, pyproject.toml, go.mod, Cargo.toml) and the commands quoted in AGENTS.md or CLAUDE.md, runs each with a time limit, and writes only the ones that succeeded to the Finite Monkey block in AGENTS.md and to the implicit contract.
2. Never add a command to AGENTS.md by hand that `onboard` reported as failed, missing or not run.
3. Show the person the `risks` list as it came. Do not rotate a secret, rewrite history, delete a file or adopt a worktree on your own: each risk needs the person's decision.
4. Running it again is safe: with the same results it changes nothing, and the history secret scan runs only the first time.

If the command answers `unknown_command` or `not_implemented`, tell the person in one line that this part of Finite Monkey is not in this version yet.
