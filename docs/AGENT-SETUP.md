# Installing Finite Monkey for a user (agent runbook)

This file is for an AI agent, such as Claude Code, that a user asked to install Finite Monkey in a project. Humans can read it too.

> **Status: pre-release.** `init`, `update`, `uninstall` and the Claude Code plugin exist in the repository and are tested, but no version 0.1.0 is on npm yet. Step 1 tells you how to detect that, and what to say to the user. Hooks are installed now; most of what they enforce (the gate, the guards) is still **(planned)**.
>
> Valid for `finitemonkey` >= 0.1.0. Check the installed version before following any later step, and stop if it is lower.

## Conduct

1. **Run the commands yourself.** Do not ask the user to type commands you can run.
2. **Ask only for decisions.** For example: which preset, which language for generated files, whether to enable an optional feature. Do not ask questions you can answer by reading the project or the command output.
3. **Never ask for secrets.** No passwords, API keys, tokens or recovery codes, not even "to finish the setup". Finite Monkey does not need any to install.
4. **Prefer `--json`.** Read the JSON output, not the human text. Follow the `next` field when it is present.
5. **Do not enable anything costly without asking.** Anything that spends money, uses paid APIs, runs long benchmarks, changes GitHub settings such as branch rulesets, or edits global configuration (`~/.claude/settings.json`, shell profiles) needs an explicit yes from the user first.
6. **Explain each step in one or two sentences, in the user's language.**
7. **Do not edit files that `init` manages.** If something looks wrong, run `doctor` and report what it says.

## Two ways to install

Both give the same hooks. Use one, or both: when a project has its own Finite Monkey hooks, the plugin's hooks step aside so nothing runs twice.

1. **The Claude Code plugin**, from the repository marketplace. Inside a Claude Code session:

   ```
   /plugin marketplace add gabrielvieiraf/finitemonkey
   /plugin install finitemonkey@finitemonkey
   ```

   The plugin brings the hooks and the skills (`task`, `verify`, `look`, `finish`) that Claude uses on its own. It carries the CLI itself (`scripts/finitemonkey.mjs`, the same build as the version in its `plugin.json`), and every hook runs `node` on that file: no `npx` and no download.

2. **`npx finitemonkey init`** in the project (steps below). It writes the hooks, the `permissions.deny` floor (plus a `Read` deny rule for each `.claudeignore` pattern), `ask` rules for pushes to `main`/`master` and for publish and deploy commands, `permissions.blockReadsOutsideWorkingDirectories: true`, `.finitemonkey/config.yml`, a project `verify` skill (`.claude/skills/verify/SKILL.md`, which runs the fast gate before each commit), and a short managed block in `AGENTS.md` that `CLAUDE.md` imports with `@AGENTS.md` (each file is created when absent; everything outside the block stays as it was) into the project. It never sets `defaultMode` or `autoMode`, only adds rules the settings do not already have, and leaves a `verify` skill the project already has as it is. The hooks run `node` on `node_modules/finitemonkey` when the project has it as a dependency; otherwise `init` copies the CLI that is running it into `.finitemonkey/runtime/` (committed, so teammates and cloud sessions get the same version) and the hooks run that copy. No hook calls `npx`. This also holds where plugins do not load (cloud sessions of a repository read the committed `.claude/settings.json`). Add `--marketplace` to also register the plugin's marketplace in the project settings for everyone who trusts the folder; it is off unless the user asks.

## What the user gets

After a successful install, the user does not need to remember any command. Finite Monkey works from context inside Claude Code: hooks on `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop` and `SubagentStop`, and skills that Claude invokes automatically by their description. Slash commands are optional shortcuts. When you finish, tell the user to keep working as usual.

## Steps

### 1. Check that a real release exists

```sh
npm view finitemonkey version
```

- If the command fails, or the version is `0.0.0` or lower than `0.1.0`, Finite Monkey is not released yet (`0.0.0` is a name reservation). Tell the user: "Finite Monkey is not released yet; there is nothing to install." Stop here.
- Otherwise continue.

### 2. Check the environment

- Node.js 20 or later: `node --version`.
- The project is a git repository: `git rev-parse --show-toplevel`.
- Working tree state: `git status --porcelain`. If there are uncommitted changes, tell the user and ask whether to continue. `init` makes backups, but the user should know.

### 3. Preview the plan

```sh
npx finitemonkey@latest init --dry-run --json
```

This reads the project and returns the plan without writing anything: `data.actions` lists each file with `create`, `merge`, `update`, `unchanged`, `keep-edited` or `skip-foreign`, `data.warnings` lists what the user should know (another plugin that also decides when a session stops, a Claude Code too old to block on a crashed hook, a file that is not Finite Monkey's), and `data.diff` shows the exact change. Summarize the plan for the user in a few lines. Ask the user only these decisions:

- Preset: `neutral` (default) or `gabriel` (adds the author's conventions, such as turning off AI attribution in commits and PRs when the project has not set it).
- Whether to register the plugin marketplace in the project (`--marketplace`).
- Whether to look back once at this project's local Claude Code sessions (`--look-back`). It reads the session logs on this machine and prints estimated counts of what Finite Monkey would have blocked, with secrets masked. Nothing is saved or sent. Without the flag, no session log is read.

### 4. Install

```sh
npx finitemonkey@latest init --yes --json
```

Pass the user's decisions as flags (for example `--preset gabriel --lang pt-BR`). Without `--yes`, `init` exits 4 with the plan and a `next` field holding the exact command to run after the user agrees. `init` backs up every file it touches to `.finitemonkey/backups/<timestamp>/`, records what it wrote in `.finitemonkey/lock.json`, merges `.claude/settings.json` without removing any user hook or permission, adds a managed block to `.gitignore` (state stays local, `config.yml` is committed), and is safe to run again: a second run with no change writes nothing.

### 5. Verify

```sh
npx finitemonkey doctor --json
```

Every item has `check`, `status` and `fix`. If any item is not `ok`, run the `fix` command when it is safe and does not fall under conduct rule 5, then run `doctor` again. Report what is left.

`npx finitemonkey doctor --fix` repairs the project files it owns (hooks, deny rules, the `.gitignore` block) with the same backup and lock as `init`, and never touches user settings or the shell profile. If the user wants to file a bug, `npx finitemonkey doctor --report` writes a masked Markdown file under `.finitemonkey/reports/` to attach to the issue.

### 6. Tell the user

In one or two sentences: what was installed, anything `doctor` could not fix, and that they can now keep working without any new command.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | A check failed |
| 2 | Usage error |
| 3 | Not configured |
| 4 | Needs the user (a decision or a confirmation) |
| 5 | Finite Monkey itself failed |

With `--json`, errors come as `{"schemaVersion":1,"error":{"code":"...","message":"...","fix":"..."}}`. Run or suggest the `fix` command.

## Update

```sh
npx finitemonkey update --check --json
npx finitemonkey update --yes --json
```

`--check` exits 1 when the managed files differ from this version and 0 when they match. `update` re-pins the hooks to the new version and refreshes generated files the user did not edit. When a newer version changed the format of a managed file, `update` also runs that version's migration, in semver order, over files the user did not edit. A generated file the user edited is kept, and the new template or migrated text is shown in `data.diff` as a proposal. A file that cannot be written for lack of permission returns `install_permission_denied` with the `fix`.

## Undo

```sh
npx finitemonkey uninstall --yes --json
npx finitemonkey uninstall --yes --purge --json
```

The first removes what Finite Monkey added and restores the backups, keeping `.finitemonkey/` (backups and evidence). `--purge` also deletes `.finitemonkey/`; after `init` then `uninstall --purge`, the project is byte-identical to before. Files the user edited after install are kept and listed in `data.kept`. Without `--yes` it exits 4 with the plan. The plugin, if installed, is removed separately: `claude plugin uninstall finitemonkey@finitemonkey`.
