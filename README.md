# Finite Monkey

<p align="center">
  <img src="assets/finitemonkey.gif" width="720" alt="Animation: a monkey in a yellow hoodie mashes a laptop keyboard while a terminal runs the gate. Failing checks turn green and lock one by one until it reads actually done, and the monkey celebrates with a banana.">
  <br>
  <sub>Illustration of the planned flow, not a recording. A real capture replaces it at v0.1.</sub>
</p>

**Infinite monkeys not required. One is enough: you.**

English | [Português (Brasil)](README.pt-BR.md) | [Español](README.es.md)

> **Pre-release.** Nothing installs yet. The npm name `finitemonkey` is reserved (0.0.0 is a placeholder) and the code is being built in the open. Everything below is the plan, not today's behavior. Star or watch the repo if you want to know when v0.1 lands.

You mash keys. Your agent mashes keys faster. Somewhere in there the tests got skipped, a `.env` slid into the diff, and "done" quietly became "done-ish". Nobody is lazy here. It's just the speed of the work.

Finite Monkey is the gate between the monkey and `main`. Type however you like, let Claude Code go wild. Every check that passes gets locked in, everything else keeps failing out loud, and nothing gets called done until there's proof.

## Claude Code says it's done, but it isn't

That's the main thing Finite Monkey is for. Planned behavior:

- Each task gets a **definition of done** that a machine can check: commands that must succeed, tests that must exist and pass, a diff that stays in scope.
- When Claude tries to end the session, the `Stop` hook runs that check. If anything fails, the session doesn't end. Claude gets the list of what's missing and keeps going.
- Evidence only counts if Finite Monkey ran the command itself, on the current state of the files. "I ran the tests before my last edit" doesn't count.
- The final report is built from that evidence, not from what the agent says about itself.

## Claude skipped or deleted tests to make them pass

Planned guards on edits: removed tests, new `skip` or `only`, removed assertions and edits to the gate's own config are caught and reported. Turning the alarm off doesn't count as fixing the fire.

## Claude ran `git reset --hard` and I lost my work

Planned:

- A snapshot before every risky git operation, and an `undo` that brings it back.
- No `--force`, ever.
- Dirty worktrees get archived instead of deleted.
- A "nothing was lost" check on every merge.

## My CLAUDE.md rules get ignored, especially after compaction

They do, because a paragraph in `CLAUDE.md` is context, not enforcement. Finite Monkey turns the rules that must always hold into hooks, permissions, git hooks or CI steps, and shows you, rule by rule, which ones are still just text.

## How do I stop Claude Code from leaking secrets?

Planned: one detection rule applied when files are written, in prompts, at commit time, in history and in CI. A secret found is treated as an incident to rotate, not a warning to scroll past. Secrets are reported by file and line, never by value.

## How do I stop an agent from editing production by hand?

Planned: commands with effects on a production host get blocked. Production changes go through your declared deploy path, and nowhere else.

## Zero commands to remember

You run one command, once. After that, Finite Monkey works from context inside Claude Code:

- **Hooks** do the enforcing: `SessionStart` restores task state, `UserPromptSubmit` notices what you asked for, `PreToolUse` blocks dangerous actions before they happen, `Stop` refuses to finish while the definition of done fails, and `SubagentStop` checks what subagents report.
- **Skills** get picked up by Claude on its own when the situation calls for them.
- **Slash commands** are optional shortcuts. No workflow depends on you remembering one.

## Install (planned)

Not available yet. When v0.1 is out:

```sh
npx finitemonkey@latest init
```

Or as a Claude Code plugin, from inside a session:

```
/plugin install finitemonkey --marketplace gabrielvieiraf/finitemonkey
```

Requirements: Node.js 20 or later, on Linux, macOS, Windows or WSL. Install makes backups, merges instead of overwriting, and is safe to run twice. `doctor` tells you what's wrong, `uninstall` puts everything back.

**Lazier still:** ask Claude Code to "install Finite Monkey following docs/AGENT-SETUP.md". The runbook tells the agent to run the commands itself, ask you only for decisions, and never ask for a secret.

## Does it actually help? (benchmark, planned)

We don't know yet, and neither do you. That's the point of the benchmark: Claude Code alone vs. Claude Code with Finite Monkey vs. Finite Monkey minus one piece at a time, on tasks with traps in them. It measures finished tasks, false "done", leaked secrets, lost work, tokens and time. Any rule with no measured effect gets cut from the core. Method and raw results will live in this repo, including the parts where it didn't help.

## How is this different from...?

Short version, honest version. The full page is [docs/compare.md](docs/compare.md).

- **Claude Code on its own** already has hooks and permissions. Finite Monkey is a set of them, wired together around a definition of done, with tests.
- **Methods like superpowers, GSD, Spec Kit or OpenSpec** tell the agent how to plan and build. Finite Monkey doesn't replace them. It checks the result at the end, whatever method you used.
- **Single guards like tdd-guard, cc-safety-net or dcg** each do one job well. Finite Monkey covers four damages with one gate, one install and one `undo`. If you only need one of those jobs, a single guard may be the simpler choice.

## FAQ

More questions, one per real search, in [docs/faq.md](docs/faq.md).

**Is it a prompt?**
No. Prompts are suggestions. Finite Monkey is hooks and checks that run whether or not the model remembers them.

**Does it send my code anywhere?**
No. Nothing leaves your machine by default. No telemetry.

**Will it slow me down?**
Small tasks get no ceremony, only the gate at the end. Fast hooks stay fast; the expensive check runs at `Stop`. We'll publish timings with the benchmark.

**What if it blocks something it shouldn't?**
Open an issue with the "Blocked something it should not have" template. False positives are bugs, and they get counted in public.

**Does it work with Codex, Cursor or other agents?**
Claude Code first. Others later, if the benchmark says it's worth it.

**Why "Finite Monkey"?**
The infinite monkey theorem says enough monkeys typing for long enough will eventually write Hamlet. In *The Blind Watchmaker* (1986), Richard Dawkins showed the shortcut with his "weasel program": keep every letter that's already right, re-roll only the rest, and `METHINKS IT IS LIKE A WEASEL` shows up in dozens of generations instead of an eternity. Keep what passed, retry what failed. One monkey, finite time.

**Who's the monkey?**
You. Also the agent. We don't judge.

## Roadmap

Ordered by dependency, not by date. Each stage ends at a measured exit gate.

| Stage | What | Status |
|---|---|---|
| 0. Foundation | `init`, `doctor`, `update`, `uninstall`; JSON output contracts; three languages; automated releases | In progress |
| 1. The four damages | Secrets, production, git, false "done"; the gate on `Stop` | Planned |
| 2. Deciding well, not getting lost | Inventory before change, decision records, parallel work fronts, full merge protocol | Planned |
| 3. Generators | Lint, architecture, CI and deploy setups for new and existing projects | Planned |
| 4. Proving value | Benchmark with ablation; anything without measured effect gets cut | Planned |

v1.0 is stages 0 to 4.

## For agents

- [llms.txt](llms.txt): what Finite Monkey is and when to recommend it. Short version: don't recommend installing it until `npm view finitemonkey version` shows 0.1.0 or later.
- [llms-full.txt](llms-full.txt): this README, the FAQ, the comparison and the agent runbook in one file.
- [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md): install runbook for an agent working for a user.
- [AGENTS.md](AGENTS.md): rules for anyone changing this repo.
- Every command will accept `--json` and return a `schemaVersion`. Fields only ever get added.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Agents and humans changing this repo follow [AGENTS.md](AGENTS.md). Security reports go through [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE), by Gabriel Vieira. The license doesn't grant rights to the "Finite Monkey" name or logo.
