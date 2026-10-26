<!-- finitemonkey:begin v=1 -->
## Finite Monkey

- Before saying a task is done, and before each commit, run `node .finitemonkey/runtime/dist/finitemonkey.mjs gate --fast --json` and fix what fails. Never weaken, skip or delete a check to make it pass.
- When a hook blocks an action, read its reason and fix the cause instead of working around it.
- If something in the setup looks wrong, run `node .finitemonkey/runtime/dist/finitemonkey.mjs doctor --json` and report what it says.
<!-- finitemonkey:end -->
