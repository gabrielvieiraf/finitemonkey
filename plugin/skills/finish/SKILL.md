---
name: finish
description: >-
  Use when a Finite Monkey hook blocked you from stopping (a message starting with "finitemonkey:" or "NOT FINISHED"), or right before you tell the person a task is done. Lists what the done contract still requires and how to close each item honestly.
when_to_use: >-
  Trigger phrases include finitemonkey: blocked, gate failed, portão, NÃO TERMINADO, NO TERMINADO, I'm done, pronto, listo.
---

# Finish: close the gate honestly

The gate decides "done" from evidence, not from what you say. Never edit `.fm/evidence/`, `.fm/lock.json`, a test or a lint config to make the gate pass.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" gate --json` and read `data`.
2. For each failing check, do the work it names, then run the check's command again through Finite Monkey so it counts as evidence.
3. Ask the person only when their judgment decides the outcome: what the product should do, which trade-off they accept, money, production, or something they own. Then ask one objective question: decision, options, your recommendation, cost and risk. A technical choice they cannot judge is not theirs to make: whether to commit or push, a branch name, an issue number, which tool to use for an edit. Take the default that keeps the work verified (leave changes uncommitted when nobody asked for a commit, never invent an issue number) and report the choice in the final message.
4. On an L task, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" audit` before you report. Write every lost request or decision into the master plan or a report, and fix every contradiction it lists.
5. `task done` lists the shortcuts in the contract that have no trigger. Give each one a trigger (`date:YYYY-MM-DD` or `count:<name> > N`) or tell the person it has none. `fm debt` lists every shortcut across tasks.
6. If the contract has a `blueprint`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" planta` and put its first line ("Your SaaS has 3 of 25 items.") in the report, with the next item it names.
7. When the gate is green and the next request has nothing to do with this task, suggest `/clear` before starting it, and `/rename <task id>` so the session is easy to find later.
8. Open the final message with whether the work is done, in the person's words, not with the git state. If you cannot finish, say so in the first sentence ("NOT FINISHED: missing A3 ...") and list what is verified, what is not, and what is pending.

If the command answers `unknown_command` or `not_implemented`, tell the person in one line that this part of Finite Monkey is not in this version yet, then report what you verified yourself.
