---
name: finish
description: >-
  Use when a Finite Monkey hook blocked you from stopping (a message starting with "finitemonkey:" or "NOT FINISHED"), or right before you tell the person a task is done. Lists what the done contract still requires and how to close each item honestly.
when_to_use: >-
  Trigger phrases include finitemonkey: blocked, gate failed, portão, NÃO TERMINADO, NO TERMINADO, I'm done, pronto, listo.
---

# Finish: close the gate honestly

The gate decides "done" from evidence, not from what you say. Never edit `.finitemonkey/evidence/`, `.finitemonkey/lock.json`, a test or a lint config to make the gate pass.

1. Run `npx --yes --prefer-offline finitemonkey@0.0.0-development gate --json` and read `data`.
2. For each failing check, do the work it names, then run the check's command again through Finite Monkey so it counts as evidence.
3. If a check needs a decision from the person, stop and ask one objective question: decision, options, your recommendation, cost and risk.
4. If you cannot finish, say so in the first sentence ("NOT FINISHED: missing A3 ...") and list what is verified, what is not, and what is pending.

If the command answers `unknown_command` or `not_implemented`, tell the person in one line that this part of Finite Monkey is not in this version yet, then report what you verified yourself.
