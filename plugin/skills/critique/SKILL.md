---
name: critique
description: >-
  Use to review a finished change before calling it done or opening a pull request. Runs the read-only reviewer on the diff, then checks every must-fix finding on the base and head commits so only real, new problems block.
when_to_use: >-
  Trigger phrases include review this, critique, code review, revisa, revisão, revisión.
---

# Critique: findings you can reproduce

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" review packet --base <base>` and pass its output, and nothing else, to the `reviewer` agent. Never pass the conversation and never use a fork for this.
2. The reviewer answers with numbered findings in three groups (must fix, should fix, nice to have), each with what it is, the problem, the fix and what happens if it is not fixed, plus a verdict and a JSON block.
3. A must-fix finding without a reproduction command and an expected result counts as should fix.
4. Give the JSON block to the `verifier` agent, which pipes it into `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" critique verify --base <base>` on stdin (a heredoc). The command runs each reproduction command on base and on head in throwaway worktrees: fails only on head keeps the finding, fails on both moves it to "already there" (a decision for the person when it is an active risk), fails on neither moves it to "not reproduced".
5. Show the person the report table with the command and both results. Fix what stays under must fix, then repeat from step 1. After three rounds the packet holds only the new diff.

If a command answers `unknown_command` or `not_implemented`, say in one line that this part of Finite Monkey is not in this version yet.
