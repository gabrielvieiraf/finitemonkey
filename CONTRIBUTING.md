# Contributing

Thanks for helping. Finite Monkey is pre-release, so expect things to move. Before changing anything, read [AGENTS.md](AGENTS.md): it lists the invariants of this repository and the checks that enforce them. They apply to humans and agents alike.

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

1. Branch from `main`. Keep one topic per branch.
2. Open a PR against `main` and fill in the template.
3. **The PR title is a Conventional Commit.** PRs are squash-merged, so the title becomes the commit on `main` and decides the next version. Pick the type for the change as a whole.
4. Changes to user-facing text go in all three languages (English, Brazilian Portuguese, Spanish) in the same PR.
5. CI must pass. Say how you verified the change.

## Releases

Releases are fully automated. Nobody edits `version` in `package.json` or `CHANGELOG.md` by hand.

- **`latest` (stable).** Every push to `main` runs CI. If the commits since the last release include a `feat`, `fix`, `perf` or breaking change, semantic-release computes the version, updates the changelog, publishes to npm with provenance and creates a GitHub release.
- **`next` (pre-release, planned).** A `next` branch will publish pre-releases such as `1.2.0-next.1` under the npm `next` tag. To try a change before it is stable, target `next`; users opt in with `npx finitemonkey@next`. Promotion to stable happens by a PR from `next` to `main`.

Publishing happens only from CI, through npm trusted publishing with provenance. No one publishes from a laptop.

For an editorial summary accompanying a release, start with the [release notes template](.github/RELEASE_NOTES_TEMPLATE.md). Describe what changed for users and the case behind it. Keep any humor to one line.

## Reporting bugs and asking for features

Use the issue forms. For security problems, do not open a public issue; follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), as stated in its section 5.
