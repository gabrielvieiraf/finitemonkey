---
name: ricochete
description: >-
  Use when a finitemonkey signals line reports a loop (the same error coming back, a contract that has not moved, edits undoing edits) or when the person asks for something they cannot check yet. Holds the exploration and judgment protocols.
when_to_use: >-
  Trigger phrases include finitemonkey signals, loop index, going in circles, rodando em círculos, dando vueltas.
---

# Ricochete: what to do after a loop

The signals line names a frontier hypothesis. When both apply, run judgment first, then exploration. Never tell the person they do not know something: say what you observed ("third time on the same error; changing strategy").

## Mode, per domain

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" perfil --json` when it answers. Beginner in the domain of the task: learn. Intermediate: explain. Advanced: deliver. No profile: explain.

- deliver: short, the decision recorded, nothing unrequested.
- explain: trade-offs with a recommendation; the person chooses.
- learn: ask the person to predict the result before you show it. When a change is held for a prediction, ask the question as the hold states it and wait for `fm: predict <concept> <answer>`; never answer it yourself.

## Exploration: the same approach keeps coming back

1. Stop trying variations of the same fix.
2. Research before the next attempt: the researcher agent, with sources and dates, or the documentation of the exact version in the lockfile.
3. Under the heading **Questions an expert would ask**, show three to five questions, each with one line on why it matters. The person picks.
4. Under **Rewritten request**, show "you asked" and "proposal" side by side. Each addition needs the person's yes.
5. Every horizon-widening answer ships with a way to judge it: one line `Judgment criterion: <check id>` naming the contract check that proves it. If no check fits, propose one and ask the person to add it (`fm: approve` for a manual check, or a new task). The Stop hook holds a horizon answer without it when a judgment signal exists.

## Judgment: results approved and caught later, or approved within seconds

1. Explain in layers, in the person's words: what changes; why it works; how to check it alone; when it stops working.
2. Executable proof instead of trust: a test whose name is a sentence ("refund returns the money to the same card"), a mock scenario, or a click path with screenshots from `finitemonkey look`. The person only judges whether the criterion describes what they wanted.
3. In learn mode, ask for the prediction first.
4. At the end, perturb on purpose: under **Perturbation questions**, ask what happens if the requirement changes, the input is invalid, the data is empty, it runs twice, or an outside service fails, and name the contract check that covers each. When a task with judgment signals closes, the Stop hook adds this list once with the coverage it found.

## Headings in other languages

- pt-BR: Perguntas que um especialista faria; Pedido reescrito; Critério de julgamento; Perguntas de perturbação.
- es: Preguntas que haría un experto; Pedido reescrito; Criterio de juicio; Preguntas de perturbación.
