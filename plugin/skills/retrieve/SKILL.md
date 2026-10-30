---
name: retrieve
description: >-
  Use when a question about this project needs a place in the code or a recorded fact. Runs a fixed ladder with a token budget per step and returns spans with anchors, never summaries.
when_to_use: >-
  Trigger phrases include where is, which file, who calls, how does this project, onde fica, qual arquivo, dónde está, qué archivo.
---

# Retrieve: grep first, model last

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" retrieve "<question or symbol>"`. Pass `--budget <tokens>` to change the budget of each step (600 by default).
2. The ladder stops at the first step that answers: exact symbol or grep, then the cached symbol map, then BM25 over valid claims and decision records. Stale or quarantined claims never come back.
3. Read the anchored lines it prints before you edit. Quote the anchor (`path:line`) when you rely on it.
4. Long agentic search or embeddings only run when an experiment arm turns `retrieve-deep` on; otherwise the command says no step answered, and you search by hand.

If a command answers `unknown_command` or `not_implemented`, say in one line that this part of Finite Monkey is not in this version yet.
