---
name: verify
description: >-
  Use before telling the person something works and before committing. Runs the project's checks through Finite Monkey so the result is recorded as evidence for the current tree instead of being taken on your word.
when_to_use: >-
  Trigger phrases include run the tests, check it works, before commit, roda os testes, confere, verifica, prueba.
---

# Verify: evidence, not claims

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" gate --fast --json`.
2. Read `data`; for every failing item, fix the cause, never the check.
3. Quote the command and its exit code when you report a result. A result from before your last edit no longer counts.

If the command answers `unknown_command` or `not_implemented`, run the project's own check command (for example `npm test`), report its exact exit code, and say that Finite Monkey did not record it.
