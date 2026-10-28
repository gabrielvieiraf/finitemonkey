---
name: orchestrate
description: >-
  Use when fronts are running and the person sends a message: send it to the right front instead of restarting work.
when_to_use: >-
  Trigger phrases include fronts, wave, frente, onda, ola, correção para a frente.
---

# Orchestrate: route the person's message to the right front

A wave of fronts is listed in the `finitemonkey:` block above the message. Each front has an id, a scope and a status.

1. Find which fronts the message fits by scope: the files, screens or features it names.
2. One front: send it with `SendMessage` to that front's agent. Never launch the front again and never start over; the hook blocks relaunching a running front.
3. The message changes what a front must deliver (its contract): first record the change with `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" fronts route <front> "<message>" --contract`, then send the message.
4. Several fronts: send it to each one.
5. No front: handle it yourself, or plan it as a front of the next wave.
6. A new front always goes through the `Agent` tool with `isolation: "worktree"` and the four-line prompt from `finitemonkey brief`.

Every message you send is added to the front's inbox, and the front's report must say what it did with it.

Keep updates to the person in three lines: what is running, what finished and was verified, what comes next.

If the command answers `unknown_command` or `not_implemented`, tell the person in one line that fronts are not in this version yet.
