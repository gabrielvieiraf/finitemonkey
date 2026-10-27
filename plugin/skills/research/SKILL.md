---
name: research
description: >-
  Use before adopting a new dependency, a provider limit or a business rule. Hands the question to the read-only researcher and records sources with dates and strength in docs/plan.
when_to_use: >-
  Trigger phrases include which version, is it still supported, what does the API allow, pesquisa, pesquise, investiga.
---

# Research: sources with dates, not memory

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" research new <topic>`. It writes `docs/plan/NNb-state-of-the-art-<topic>.md`, next to the inventory of the same topic when there is one.
2. Write the question and the decision it unlocks. Pass only those, plus the output of `finitemonkey map` and the path of the inventory, to the `researcher` agent. Never pass the conversation.
3. Copy the researcher's tables into the record: sources (ID, source, URL, accessed date, kind, version), findings (finding, strength, sources) and versions (library, version, where it was checked, date). Keep "Not read" and "Not verified" on top and fill them honestly.
4. Primary sources first. A vendor number is kind `vendor`. A third-party documentation index is kind `index` with its version and date, and never makes a finding strong alone.
5. Run `research check`. Fix what it lists. Bring "Text for the plan" in with `plan consolidate`.

If a command answers `unknown_command` or `not_implemented`, say in one line that this part of Finite Monkey is not in this version yet.
