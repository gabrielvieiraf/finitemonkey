# Finite Monkey plugin for Claude Code

Infinite monkeys not required. This plugin carries the `finitemonkey` command line tool itself (`scripts/finitemonkey.mjs`, the readable, unminified build of the version in `.claude-plugin/plugin.json`). Its hooks run on session start, every prompt, every tool call and every stop, so a task is only "done" when the done contract passes, secrets and destructive git commands are guarded, and the agent cannot rewrite the evidence that judges it.

You do not need to remember any command. Claude uses the skills on its own when the situation fits: `task` when non-trivial work starts, `verify` before claiming something works, `look` after visual changes, and `finish` when the gate blocks a stop. `/finitemonkey:doctor` is an optional shortcut.

Install from the repository marketplace:

```
/plugin marketplace add gabrielvieiraf/finitemonkey
/plugin install finitemonkey@finitemonkey
```

When a project also ran `npx finitemonkey init`, the project's own hooks take over and the plugin's hooks step aside, so nothing runs twice. Every hook runs `node` on that bundled file: no download and no network, in any hook. Licensed under Apache-2.0.
