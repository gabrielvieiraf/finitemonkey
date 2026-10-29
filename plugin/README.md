# Finite Monkey plugin for Claude Code

Infinite monkeys not required. This plugin carries the `finitemonkey` command line tool itself (`scripts/finitemonkey.mjs`, the readable, unminified build of the version in `.claude-plugin/plugin.json`). Its hooks run on session start, every prompt, every tool call and every stop, so a task is only "done" when the done contract passes, secrets and destructive git commands are guarded, and the agent cannot rewrite the evidence that judges it.

You do not need to remember any command. Claude uses the skills on its own when the situation fits: `task` when non-trivial work starts, `verify` before claiming something works, `look` after visual changes, and `finish` when the gate blocks a stop. `/finitemonkey:doctor` is an optional shortcut.

Install from the repository marketplace:

```
/plugin marketplace add gabrielvieiraf/finitemonkey
/plugin install finitemonkey@finitemonkey
```

The `next` channel has its own marketplace, from the `next` branch. Enable only one of the two, since both plugins are called `finitemonkey`:

```
/plugin marketplace add gabrielvieiraf/finitemonkey#next
/plugin install finitemonkey@finitemonkey-next
```

When a project also ran `npx finitemonkey init`, the project's own hooks take over and the plugin's hooks step aside, so nothing runs twice. Every hook runs `node` on that bundled file: no download and no network, in any hook. Licensed under Apache-2.0.

On Claude Code 2.1.287 and newer the plugin also loads a mod, `hooks/register.mjs`, next to the command hooks. The command hooks stay the authority for blocks, verdicts and evidence; the mod only draws, tightens permission decisions and measures, and makes no network or model call. Its reach, as `claude plugin validate --json` reports it, is listed in `FOOTPRINT.json` and checked in CI.

What the mod adds, on the terminal, the Desktop app and the VS Code extension: a band above the prompt with the gate state, what is not verified and how old the evidence is; `/fm` opens the gate pane, `/fm cost` the cost of the active contract, `/fm fronts` every worktree with its gate and the files two fronts both changed, and `/fm handoff` prints a brief built from the ledger and compacts the session with it. In `claude -p` the same commands print text. Each pane only shows what `finitemonkey status`, `mod cost`, `fronts board` and `handoff` already report.
