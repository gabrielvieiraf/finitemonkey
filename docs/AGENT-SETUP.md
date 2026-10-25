# Installing Finite Monkey for a user (agent runbook)

This file is for an AI agent, such as Claude Code, that a user asked to install Finite Monkey in a project. Humans can read it too.

> **Status: planned.** Finite Monkey has not been released. The commands below describe the planned interface. Step 1 tells you how to detect that, and what to say to the user.
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

This reads the project and returns the plan without writing anything: files to create, files to merge, files left untouched, and the reason for each. Summarize the plan for the user in a few lines. If the output lists decisions (for example a preset or a language), ask the user now.

### 4. Install

```sh
npx finitemonkey@latest init --yes --json
```

Pass the user's decisions as flags (for example `--lang pt-BR`). `init` backs up every file it touches, merges instead of overwriting, and is safe to run again.

### 5. Verify

```sh
npx finitemonkey doctor --json
```

Every item has `check`, `status` and `fix`. If any item is not `ok`, run the `fix` command when it is safe and does not fall under conduct rule 5, then run `doctor` again. Report what is left.

### 6. Tell the user

In one or two sentences: what was installed, anything `doctor` could not fix, and that they can now keep working without any new command.

## Planned exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | A check failed |
| 2 | Usage error |
| 3 | Not configured |
| 4 | Needs the user (a decision or a confirmation) |
| 5 | Finite Monkey itself failed |

With `--json`, errors come as `{"schemaVersion":1,"error":{"code":"...","message":"...","fix":"..."}}`. Run or suggest the `fix` command.

## Undo

```sh
npx finitemonkey uninstall --json
```

Removes what Finite Monkey added and restores backups. Files the user edited after install are kept and listed.
