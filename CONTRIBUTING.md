# Contributing

Before changing anything, read [AGENTS.md](AGENTS.md): it lists the invariants of this repository and the checks that enforce them. They apply to humans and agents alike.

## Setup

```sh
git clone https://github.com/gabrielvieiraf/finitemonkey.git
cd finitemonkey
npm ci
```

`npm ci` installs the `commit-msg` hook, which checks every commit message with commitlint. Node.js 20 or later is required.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(optional scope): short subject in lowercase
```

| Type | Use for | Release effect |
|---|---|---|
| `feat` | A new user-facing capability | Minor version |
| `fix` | A bug fix | Patch version |
| `feat!`, `fix!` or a `BREAKING CHANGE:` footer | A change that breaks users or the JSON contract | Major version |
| `docs`, `test`, `refactor`, `ci`, `chore`, `build`, `perf`, `style` | Everything else | No release, except `perf` (patch) |

Do not add AI attribution to commits or PRs (no `Co-Authored-By` for AI tools, no "Generated with" footers). The `sem-atribuicao` check fails the PR if you do.

## Pull requests

1. Branch from `next`, the integration branch until the first stable release. Keep one topic per branch.
2. Open a PR against `next` and fill in the template.
3. **The PR title is a Conventional Commit.** PRs are squash-merged, so the title becomes the commit on the target branch and decides the next version. Pick the type for the change as a whole.
4. Changes to user-facing text go in all three languages (English, Brazilian Portuguese, Spanish) in the same PR.
5. CI must pass. Say how you verified the change.

## Bypass probe

Bypass detection assumes that Claude Code fires `PostToolUse` after another mod approves a call a Finite Monkey guard denied at `PreToolUse`. The tests only play that order through a scripted Claude Code. To check it on a real session, a person runs the probe; it is never run in CI or by an agent.

1. From a checkout of this repository, at a terminal, run `npx tsx scripts/bypass-probe.ts --project <your project> --yes`. It prints what it will do first; without `--yes` or without a terminal it stops.
2. It starts one `claude -p` session (at most 4 turns) on your login, in a temporary git repository, with this repository's `plugin/` and a fixture mod that answers `allow` to every `tool.check`. The prompt asks for one `Write` to `.finitemonkey/cache/probe-bypass.txt`, which the command hooks deny.
3. It records one outcome for your Claude Code version in `<your project>/.finitemonkey/cache/bypass-probe.json`: `fired` (the call ran and `PostToolUse` recorded the bypass), `missed` (the call ran with no `PostToolUse`), `held` (the deny held, so nothing ran) or `inconclusive` (no deny was seen). `finitemonkey doctor` in that project then shows the result instead of "not confirmed".
4. It writes the `InstructionsLoaded` events of the same session to `<your project>/.finitemonkey/cache/instructions-capture.jsonl`. To replace `test/fixtures/instructions/session.jsonl` with it, rewrite the home and project paths to the fixture's `/home/test` and `/home/ana/project`, keep the order of the lines, and run `test/instructions.test.ts`.
5. Put the outcome and the Claude Code version in the pull request that updates the threat model's open question.

## Releases

Releases are fully automated. Nobody edits `version` in `package.json` or `CHANGELOG.md` by hand.

- **`latest` (stable).** No stable version has been released yet; `latest` points to `0.0.0`, a placeholder that holds the name. Every push to `main` runs CI. If the commits since the last release include a `feat`, `fix`, `perf` or breaking change, semantic-release computes the version, updates the changelog, publishes to npm with provenance and creates a GitHub release.
- **`next` (pre-release).** Every push to the `next` branch with a releasable commit publishes a pre-release such as `0.1.0-next.40` under the npm `next` tag. Changes target `next`; users opt in with `npx finitemonkey@next`. Promotion to stable happens by a PR from `next` to `main`.

Publishing happens only from CI, through npm trusted publishing with provenance. No one publishes from a laptop.

For an editorial summary accompanying a release, start with the [release notes template](.github/RELEASE_NOTES_TEMPLATE.md). Describe what changed for users and the case behind it. Keep any humor to one line.

## Reporting bugs and asking for features

Use the issue forms. For security problems, do not open a public issue; follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), as stated in its section 5.
