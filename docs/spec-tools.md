# Spec Kit and OpenSpec

Spec Kit and OpenSpec plan the work and ask for a verification step. Finite Monkey checks the work and has no planning step. This page joins the two without writing the definition of done twice.

## From a tasks file to a done contract

```bash
npx finitemonkey task from-spec specs/001-checkout/tasks.md --port 3000
npx finitemonkey task from-spec openspec/changes/add-pix/tasks.md --id add-pix
```

- Spec Kit lines like `- [ ] T002 [P] [US1] ...` and OpenSpec lines like `- [ ] 1.2 ...` each become one criterion. The `T002` or `1.2` id is kept next to it.
- A command in backticks (`npm test -- pix`) becomes a `command` check.
- An EARS line (`WHEN ... THE SYSTEM SHALL ...`) or an OpenSpec scenario (`**WHEN**` / `**THEN**`) that names a `GET` route and a status code becomes a `runtime` check when you pass `--port`.
- Everything else becomes a `manual` check, and the command lists it as "no executable check" so you can add one.
- Without `--id` the command only prints the proposed contract. With `--id` it saves it as the active task.
- The source file is only read. The output carries its SHA-256 so a test can prove it did not change.

## Running the gate from these tools

Once `npx finitemonkey init` ran, the Claude Code `Stop` hook already runs the gate whenever the agent tries to finish, whichever tool wrote the plan.

Spec Kit lifecycle hooks in `.specify/extensions.yml` (for example `after_implement`) call Spec Kit commands, not shell commands, according to the Spec Kit extension user guide read on 2026-10-27 (https://github.com/github/spec-kit/blob/main/extensions/EXTENSION-USER-GUIDE.md). To add the gate there, point the hook at a command whose text asks the agent to run `npx finitemonkey gate` and to stop on a failure.

In a workflow or CI job, add a shell step:

```yaml
- run: npx finitemonkey ci gate
```

## A design document as contract input

An approved design document (an OpenSpec `design.md`, a Spec Kit `plan.md`) is input, not the contract. Copy its acceptance scenarios into the tasks file as EARS lines or checkboxes, run `task from-spec`, and keep the decision itself in `docs/plan/` with `finitemonkey decide new <topic>`.
