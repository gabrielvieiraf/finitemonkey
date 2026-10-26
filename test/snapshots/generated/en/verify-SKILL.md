---
name: verify
description: >-
  Use before every commit and before telling the person something works. Runs the fast gate through Finite Monkey so the result is recorded as evidence for the current tree instead of being taken on your word.
when_to_use: >-
  Trigger phrases include commit, run the tests, check it works, roda os testes, confere, verifica, prueba.
---

# Verify: evidence, not claims

1. From the project root, run `node .finitemonkey/runtime/dist/finitemonkey.mjs gate --fast --json`.
2. Read `data`; for every failing item, fix the cause, never the check.
3. Quote the command and its exit code when you report a result. A result from before your last edit no longer counts.

<!-- finitemonkey:generated v=1 -->
