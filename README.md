# Finite Monkey

**Infinite monkeys not required.**

English | [Português (Brasil)](README.pt-BR.md) | [Español](README.es.md)

> **Status: pre-release.** Nothing here works yet. The npm name `finitemonkey` is reserved and the code is being built in the open. Everything below describes what Finite Monkey is planned to do, not what it does today.

## The idea

The infinite monkey theorem says that enough monkeys typing for long enough will eventually produce Hamlet. In *The Blind Watchmaker* (1986), Richard Dawkins showed a shortcut with his "weasel program": keep every letter that is already right, re-roll only the rest, and the phrase `METHINKS IT IS LIKE A WEASEL` appears in dozens of generations instead of an eternity. Cumulative selection keeps what passed.

Finite Monkey applies that to coding agents. The agent can make mistakes freely. A gate keeps what has been verified and only lets work through once it is proven. One monkey, finite time, finished work.

## The problem

Coding agents are strong enough to build large systems in hours. What fails is everything around them:

- The agent says "done" and it is not done.
- Tests pass because they were weakened or skipped.
- Rules written in `CLAUDE.md` or `AGENTS.md` are forgotten, especially after context compaction, because prose is context, not enforcement.
- Work is lost to `git reset --hard`, a forced push or a deleted worktree.
- A secret ends up in a commit, a log or a pull request.

These are failures of verification and control, not of intelligence. More Markdown, more phases and more personas do not fix them. Mechanism does.

## What it will do (planned)

### You just work; the monkey gets gated

Finite Monkey is designed to need **zero commands to remember**. You run `npx finitemonkey init` once. After that it acts on its own, from context, inside Claude Code:

- **Hooks** do the enforcing: `SessionStart` restores the task state, `UserPromptSubmit` notices what you asked for, `PreToolUse` blocks dangerous actions before they happen, `Stop` refuses to end the session while the definition of done fails, and `SubagentStop` checks what subagents report.
- **Skills** are invoked by Claude automatically, based on their description, when the situation calls for them.
- **Slash commands** exist only as optional shortcuts. No workflow requires them.

### A definition of done verified by machine

Each task gets a contract of what "done" means: commands that must succeed, tests that must exist and pass, a diff that stays in scope, and more. The `Stop` hook runs the gate and blocks the end of the session with the list of what is still missing. Evidence is recorded only from commands Finite Monkey ran itself, tied to the hash of the working tree, so "I ran the tests before my last edit" does not count. The final report is generated from that evidence, not from what the agent says.

### The four damages it prevents first

The first stage of the roadmap covers only what is irreversible or corrupts the proof:

1. **Leaking secrets.** One detection rule applied when files are written, in prompts, at commit time, in history and in CI. A secret found is an incident to rotate, not a warning to ignore. Secrets are cited by file and line, never by value.
2. **Editing production by hand.** Commands with effects on a production host are blocked. Production changes only through the declared deploy path.
3. **Losing work in git.** A snapshot before every risky git operation, an `undo` that restores it, no `--force` ever, dirty worktrees archived instead of deleted, and a "nothing was lost" check on every merge.
4. **False "done".** The gate above, plus guards against removed tests, new `skip` or `only`, removed assertions and edits to the gate's own configuration.

### Principles

- **Proportional ceremony.** A small task has no phases, only the gate. Larger tasks get a short plan and an independent review.
- **Rules become mechanism.** A rule that must always hold becomes a hook, a permission, a git hook or a CI step, not a paragraph. Finite Monkey shows, per rule, where it is only text.
- **Every rule proves its value or goes.** A benchmark compares Claude Code alone, with Finite Monkey and with Finite Monkey minus one piece at a time. A rule with no measured effect leaves the core.
- **Never break what exists.** Install with backup, structural merge, a lock file, idempotent re-runs, `doctor`, `update` and a clean `uninstall`.
- **Nothing leaves your machine by default.** No telemetry.
- **Output for agents is a contract.** Every command will accept `--json` and return a `schemaVersion`; fields are only ever added.
- **Three languages.** English, Brazilian Portuguese and Spanish.

## Roadmap

Ordered by dependency, not by date. Each stage ends at a measured exit gate.

| Stage | Content | Status |
|---|---|---|
| 0. Foundation | Executable with `init`, `doctor`, `update`, `uninstall`; JSON contracts; i18n; automated releases | In progress |
| 1. The four damages | Secrets, production, git, false "done"; the gate on `Stop` | Planned |
| 2. Deciding well and not getting lost | Inventory before change, decision records, cost and parity checks, parallel work fronts, full merge protocol, rules compiled per surface | Planned |
| 3. Generators | Lint, architecture, CI and deploy generators for new and existing projects | Planned |
| 4. Proving value | Benchmark with ablation; pieces without measured effect are cut | Planned |

Version 1.0 is the whole of stages 0 to 4.

## Install (planned)

Not available yet. When the first release is out, the main path will be:

```sh
npx finitemonkey@latest init
```

That is the only command you are meant to need. Requirements will be Node.js 20 or later, on Linux, macOS, Windows or WSL. Standalone executables for people without Node are planned. You will also be able to ask Claude Code to install it for you; the agent follows [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md).

## How releases work

- Versions are decided by commit messages. The repository uses [Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint on every commit.
- On every push to `main`, CI runs the checks and [semantic-release](https://semantic-release.gitbook.io/) computes the version, writes the changelog, publishes to npm and creates the GitHub release. Nobody edits the version by hand.
- Packages are published only from CI, with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can verify that a version was built from this repository.
- Two channels are planned: `latest` for stable releases and `next` for pre-releases. Stable is the default; `next` is opt-in.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Agents and humans changing this repository must follow [AGENTS.md](AGENTS.md). Security reports go through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE), by Gabriel Vieira.
