# AGENTS.md

Rules for anyone, human or agent, who changes this repository. Read this before your first edit.

Finite Monkey is pre-release. Most of the product does not exist yet, and some of the checks below are still planned. A planned check is marked **(planned)**. Until it exists, the invariant still holds and reviewers enforce it by hand.

## What this project is

A gate that makes coding agents finish verified work. The core user experience is "you just work; the monkey gets gated": after one `npx finitemonkey init`, Finite Monkey acts from context through Claude Code hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`, `SubagentStop`) and skills that Claude invokes by their description. Slash commands are optional shortcuts. Never design a feature that only works if the user remembers a command. See [README.md](README.md) for the vision and the roadmap.

## Invariants

Do not break these. Every invariant names the check that enforces it. When you add behavior, add the test or check that proves it.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | **No code comments.** Code explains itself through names and small functions. Shortcuts and decisions are recorded in docs or commit messages, not in comments. | ESLint rule `finitemonkey/no-comments` (`eslint/no-comments.mjs`) in `npm run check` |
| I2 | **Named exports only.** No `export default` in source code. Config files that a tool requires to use a default export (such as `commitlint.config.mjs`) are the only exception. | ESLint `no-restricted-syntax` on `ExportDefaultDeclaration` in `npm run check` |
| I3 | **No AI attribution** in commits, PR titles or PR bodies. No `Co-Authored-By` lines for AI tools, no "Generated with" footers, no session links. | CI workflow `sem-atribuicao` on every PR; `.claude/settings.json` sets `attribution.commit` and `attribution.pr` to empty and `sessionUrl` to false |
| I4 | **Conventional Commits.** Every commit message follows `type(scope): subject`. The version is computed from them. | commitlint in the `commit-msg` hook (`.husky/commit-msg`); the same check in CI **(planned)** |
| I5 | **The PR title decides the version.** PRs are squash-merged, so the PR title becomes the commit on `main`. It must be a valid Conventional Commit and describe the change at the right level: `feat` for a new user-facing capability, `fix` for a bug, `feat!` or a `BREAKING CHANGE:` footer for a breaking change, `docs`, `chore`, `ci`, `test`, `refactor` for the rest. | PR title lint in CI **(planned)** |
| I6 | **Never edit the version or the changelog by hand.** `package.json` `version` and `CHANGELOG.md` are written only by semantic-release. | Release job in `.github/workflows/ci.yml`; review |
| I7 | **i18n parity.** User-facing text exists in English, Brazilian Portuguese and Spanish with the same content: `README.md`, `README.pt-BR.md` and `README.es.md` today, CLI messages and generated templates later. Change one, change all three in the same PR. English is the source. | Heading and key parity check `finitemonkey i18n check` **(planned)** |
| I8 | **JSON output is a contract.** Every `--json` output carries `schemaVersion`, and every named payload carries `schema` (`finitemonkey/<name>@<version>`). Within a schema version, fields are only added, never renamed, retyped or removed; a breaking change ships as `<name>@<version+1>`. Errors use `{"schemaVersion":1,"error":{"code","message","fix"}}`. JSON keys and error codes are never translated. The schemas live in `docs/schema/`, generated from the TypeScript types listed in `scripts/schema-gen.ts` (`npm run schema`). A frozen copy of each one sits in `test/fixtures/schema/`; update the generated file, never the frozen copy. | `npm run schema:check` fails on a stale schema; `test/schema.test.ts` fails when a frozen field is removed, renamed, retyped or made optional; `test/contract.test.ts` |
| I9 | **Generated files are committed and checked.** `dist/` and any other generated file are built from source, committed, and must match a fresh build. | `git diff --exit-code` after the build in CI **(planned)** |
| I10 | **Small modules.** One responsibility per file. Split a file before it grows past the size limit instead of adding to it. | ESLint `max-lines` (300 per file) and `max-lines-per-function` (50 in `src/`) in `npm run check` |
| I11 | **Never print secrets.** No secret value in output, logs, reports, tests, fixtures, commits or PRs. Refer to a secret by file and line. Test fixtures use obviously fake placeholders. | Output masker `src/mask/` with canary tests (`test/mask.test.ts`) and `finitemonkey secrets scan`; secret scanning in CI **(planned)** |
| I12 | **The package ships only what is listed.** `files` in `package.json` is explicit. | `npm run check` (`npm pack --dry-run`) in CI |
| I13 | **No em dashes in prose.** Use a period, a colon, a comma or parentheses. | Docs lint **(planned)** |
| I14 | **Nothing leaves the user's machine by default.** No telemetry, no network call that the user did not ask for. | Tests that run the CLI with the network blocked **(planned)** |
| I15 | **Gates fail closed.** A hook or check that cannot run blocks and says why; it never passes silently. | Tests that break the executable and expect a block **(planned)** |

## Working rules

- Branch from `main`, open a PR, never push to `main` directly. Never force push a shared branch.
- Keep PRs small and about one thing.
- Do not claim a feature works in docs, PR bodies or release notes until a test proves it. Pre-release docs say "planned".
- Do not add fixed context (more lines in this file, in `CLAUDE.md` or in a `SessionStart` hook) without a reason you can state in the PR.
- Do not touch the release configuration (`.releaserc.json`, `.github/workflows/`) in a PR about something else.

## Where things are

| Path | What |
|---|---|
| `README.md`, `README.pt-BR.md`, `README.es.md` | User documentation in three languages |
| `docs/AGENT-SETUP.md` | Runbook for an agent installing Finite Monkey for a user |
| `llms.txt` | Summary for language models that recommend tools |
| `CONTRIBUTING.md` | Commit, PR and release flow |
| `SECURITY.md` | How to report a vulnerability |
| `docs/schema/` | JSON Schema of every named `--json` payload, generated from the TypeScript types |
| `docs/FAILURE-MODES.md` | Known failure modes and the test behind each mitigation, generated by `npm run docs` from `scripts/failure-modes.ts` |
| `src/core/footprint.ts` | The files, paths and hosts Finite Monkey reads, writes and sends to; the README and `SECURITY.md` section is generated from it |
| `.github/workflows/ci.yml` | Checks and the release job |
| `bench/` | Pre-registration, deviations, pinned arms and tasks of the benchmark; `npm run bench -- --seed <n> --dry-run` prints the schedule, and a real run needs `--yes` at a terminal |
| `budgets.json` | Ceilings for fixed context bytes and `PreToolUse` p95 latency per guard, checked by `npm run budgets` in CI |
| `.github/workflows/sem-atribuicao.yml` | The no-attribution check (I3) |
| `.github/workflows/claude-latest.yml` | Weekly run against the newest Claude Code: version, flags still in `--help`, and three real `Stop` sessions (`npm run e2e:claude`, needs the `ANTHROPIC_API_KEY` secret) |
| `test/fake-claude.ts` | A scriptable fake `claude` that runs the configured hooks, writes transcripts, feeds the statusline and sends SIGINT |
| `.releaserc.json` | semantic-release configuration |
