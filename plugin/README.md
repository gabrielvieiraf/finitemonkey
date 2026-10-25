# Finite Monkey plugin for Claude Code

Infinite monkeys not required. This plugin connects Claude Code to the `finitemonkey` command line tool, pinned to the exact version in `.claude-plugin/plugin.json`. Its hooks run on session start, every prompt, every tool call and every stop, so a task is only "done" when the done contract passes, secrets and destructive git commands are guarded, and the agent cannot rewrite the evidence that judges it.

You do not need to remember any command. Claude uses the skills on its own when the situation fits: `task` when non-trivial work starts, `verify` before claiming something works, `look` after visual changes, and `finish` when the gate blocks a stop. `/finitemonkey:doctor` is an optional shortcut.

Install from the repository marketplace:

```
/plugin marketplace add gabrielvieiraf/finitemonkey
/plugin install finitemonkey@finitemonkey
```

When a project also ran `npx finitemonkey init`, the project's own hooks take over and the plugin's hooks step aside, so nothing runs twice. Hooks run the CLI with `npx --prefer-offline`; the first session downloads it once, later ones work offline. Licensed under Apache-2.0.
