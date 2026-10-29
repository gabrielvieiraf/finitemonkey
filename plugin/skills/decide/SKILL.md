---
name: decide
description: >-
  Use before an architecture, library or vendor choice, or before replacing a component. Writes a decision record with criteria fixed before the options, a do-nothing option and the way back.
when_to_use: >-
  Trigger phrases include which should we use, build or buy, choose between, decide, decidir, qual usar, cuál usar.
---

# Decide: criteria first, then options

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" decide new <topic>`. It writes `docs/plan/NN-decision-<topic>.md` with the required sections in order. Keep the order.
2. Fill "Today" from the inventory (`finitemonkey inventory <topic>`) on L tasks.
3. Write the criteria table (criterion, weight 1 to 5, origin) before you list any alternative. Do not change a weight after scoring.
4. Score every alternative, "Do nothing" included. When a critical criterion has no evidence, write and run a small test and put the command and its result under "Proof".
5. Mark claims: `FACT: <claim> (<source URL or file:line>, YYYY-MM-DD)`. A FACT without source and date fails the check; write ASSUMPTION or OPINION instead. An assumption can carry fields after ` | `: `ASSUMPTION: <claim> | impact: high | verify: <cheapest check> | trigger: file:<path>` (or `date:YYYY-MM-DD`); `decide check` copies it to the assumption register, and a task that relies on it lists its id under `assumptions:` in the contract.
6. Fill reversibility (how to undo it and what that costs), no-regret moves, the delta (added, modified, removed; each removal names its parity row), what you left out on purpose, risks, points to prove and the limits of the analysis.
7. Put what changes in the master plan under "What changes in the plan" and run `plan consolidate` after.
8. Run `decide check`. Fix what it lists.

Build or buy, for a library or a vendor: prefer what the project already uses; then a maintained library with a recent release and a license that fits; then a vendor whose limits and price are written down with a date; build only what is the product's own edge or what nothing above covers. Record the versions you checked in the registry, not from memory.

When the choice needs the person, set status to `needs-person` and ask with exactly five lines:

- **Decision:** what has to be chosen
- **Options:** the alternatives, "do nothing" included
- **Recommendation:** which one and why, in one line
- **Cost:** money and time of the recommendation
- **Risk:** what goes wrong if it is wrong, and the way back

Leave the status at `proposed` or `needs-person`. Only the person accepts a record, with `finitemonkey decide accept <record>` in a terminal; a write that sets `accepted` from here is held.

To replace a decision, write the new record, then `decide revoke <old> --by <new>`. The old record keeps its text and gains a banner. Never delete a record.

If a command answers `unknown_command` or `not_implemented`, say in one line that this part of Finite Monkey is not in this version yet.
