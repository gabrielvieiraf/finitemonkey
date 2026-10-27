# Changelog

## [0.1.0-next.20](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.19...v0.1.0-next.20) (2026-10-27)

### Features

* **git:** git hooks through husky, lefthook or pre-commit, and finitemonkey ci gate ([#157](https://github.com/gabrielvieiraf/finitemonkey/issues/157)) ([c90ac3c](https://github.com/gabrielvieiraf/finitemonkey/commit/c90ac3c8817b9f2a5922f3c740211f0a07b90ddb)), closes [#149](https://github.com/gabrielvieiraf/finitemonkey/issues/149) [#42](https://github.com/gabrielvieiraf/finitemonkey/issues/42)

## [0.1.0-next.19](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.18...v0.1.0-next.19) (2026-10-27)

### Features

* **secrets:** provider runbooks for incidents and an opt-in live-key check ([#156](https://github.com/gabrielvieiraf/finitemonkey/issues/156)) ([725d59e](https://github.com/gabrielvieiraf/finitemonkey/commit/725d59e1eca07fddb081140cdb939fd7827666bc)), closes [#151](https://github.com/gabrielvieiraf/finitemonkey/issues/151) [#151](https://github.com/gabrielvieiraf/finitemonkey/issues/151) [#49](https://github.com/gabrielvieiraf/finitemonkey/issues/49)

### Bug Fixes

* **git:** give the safety snapshot and the Windows hook timing more room ([#166](https://github.com/gabrielvieiraf/finitemonkey/issues/166)) ([81c5e2d](https://github.com/gabrielvieiraf/finitemonkey/commit/81c5e2d03a7cdb4e0a7c30a7ef11e91aa4c89c06))

## [0.1.0-next.18](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.17...v0.1.0-next.18) (2026-10-27)

### Features

* **gate:** fm off and fm on typed by the person pause the gate for one session ([#155](https://github.com/gabrielvieiraf/finitemonkey/issues/155)) ([a9be0bb](https://github.com/gabrielvieiraf/finitemonkey/commit/a9be0bb38637e13297fa324ed81e0edbac9b2138)), closes [#47](https://github.com/gabrielvieiraf/finitemonkey/issues/47) [#152](https://github.com/gabrielvieiraf/finitemonkey/issues/152) [#152](https://github.com/gabrielvieiraf/finitemonkey/issues/152)

## [0.1.0-next.17](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.16...v0.1.0-next.17) (2026-10-27)

### Features

* **gate:** runtime check starts the app and calls one route ([#154](https://github.com/gabrielvieiraf/finitemonkey/issues/154)) ([36ac3ba](https://github.com/gabrielvieiraf/finitemonkey/commit/36ac3ba04810e57b88c40e7ee593fcf55af579d9)), closes [#40](https://github.com/gabrielvieiraf/finitemonkey/issues/40) [#151](https://github.com/gabrielvieiraf/finitemonkey/issues/151)

## [0.1.0-next.16](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.15...v0.1.0-next.16) (2026-10-27)

### Features

* **gate:** callers check for removed or renamed symbols that are still called ([#150](https://github.com/gabrielvieiraf/finitemonkey/issues/150)) ([4c5f335](https://github.com/gabrielvieiraf/finitemonkey/commit/4c5f335cd4c431f603710345b3e5f4199054e746)), closes [#39](https://github.com/gabrielvieiraf/finitemonkey/issues/39)
* **policy:** guard modes off, shadow and active from a project policy file ([#152](https://github.com/gabrielvieiraf/finitemonkey/issues/152)) ([767bbe2](https://github.com/gabrielvieiraf/finitemonkey/commit/767bbe2edcefca4dc787ee8c71b5457bde26e6c8)), closes [#44](https://github.com/gabrielvieiraf/finitemonkey/issues/44)

## [0.1.0-next.15](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.14...v0.1.0-next.15) (2026-10-26)

### Features

* **gate:** compute task size from the real diff and touched paths ([#148](https://github.com/gabrielvieiraf/finitemonkey/issues/148)) ([f271bdd](https://github.com/gabrielvieiraf/finitemonkey/commit/f271bdd03ebeaaf3f047a5f77c8c8d74329a52cd)), closes [#52](https://github.com/gabrielvieiraf/finitemonkey/issues/52)
* **secrets:** warn on secrets in process args, disabled TLS and credentials in git remotes ([#149](https://github.com/gabrielvieiraf/finitemonkey/issues/149)) ([e821dd7](https://github.com/gabrielvieiraf/finitemonkey/commit/e821dd7a4a2806678e100c062f5d27d172f5dd9a)), closes [#50](https://github.com/gabrielvieiraf/finitemonkey/issues/50)

## [0.1.0-next.14](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.13...v0.1.0-next.14) (2026-10-26)

### Features

* **plugin:** next channel as its own marketplace, and doctor flags both enabled ([#146](https://github.com/gabrielvieiraf/finitemonkey/issues/146)) ([0328318](https://github.com/gabrielvieiraf/finitemonkey/commit/03283183abefbe25e1cd3be9091f394292257ea0)), closes [#28](https://github.com/gabrielvieiraf/finitemonkey/issues/28)

## [0.1.0-next.13](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.12...v0.1.0-next.13) (2026-10-26)

### Features

* **init:** optional look back at past local Claude Code sessions ([#145](https://github.com/gabrielvieiraf/finitemonkey/issues/145)) ([66852fb](https://github.com/gabrielvieiraf/finitemonkey/commit/66852fb8f4e3cd6bde7c307cd87778154e7b1d72)), closes [#30](https://github.com/gabrielvieiraf/finitemonkey/issues/30)

## [0.1.0-next.12](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.11...v0.1.0-next.12) (2026-10-26)

### Features

* **platform:** resolve .cmd shims, warn on WSL mounts and synced folders, check autocrlf ([#144](https://github.com/gabrielvieiraf/finitemonkey/issues/144)) ([15d38f1](https://github.com/gabrielvieiraf/finitemonkey/commit/15d38f168e4cc9291ac48d659846714ddf85b8b6)), closes [#31](https://github.com/gabrielvieiraf/finitemonkey/issues/31)

## [0.1.0-next.11](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.10...v0.1.0-next.11) (2026-10-26)

### Features

* **doctor:** add doctor --fix and doctor --report ([#140](https://github.com/gabrielvieiraf/finitemonkey/issues/140)) ([1385876](https://github.com/gabrielvieiraf/finitemonkey/commit/13858768780089c38bd314d2f006da16c161f65e)), closes [#23](https://github.com/gabrielvieiraf/finitemonkey/issues/23) [#137](https://github.com/gabrielvieiraf/finitemonkey/issues/137) [#21](https://github.com/gabrielvieiraf/finitemonkey/issues/21) [#137](https://github.com/gabrielvieiraf/finitemonkey/issues/137)
* **doctor:** fire each registered hook with a synthetic event and validate hooks.json ([#137](https://github.com/gabrielvieiraf/finitemonkey/issues/137)) ([bd289e1](https://github.com/gabrielvieiraf/finitemonkey/commit/bd289e1178d313ac2bc381ead0a84164b9673fb9)), closes [#21](https://github.com/gabrielvieiraf/finitemonkey/issues/21) [#134](https://github.com/gabrielvieiraf/finitemonkey/issues/134) [#22](https://github.com/gabrielvieiraf/finitemonkey/issues/22) [#136](https://github.com/gabrielvieiraf/finitemonkey/issues/136)
* **doctor:** report the settings, tools and files that weaken the guards ([#134](https://github.com/gabrielvieiraf/finitemonkey/issues/134)) ([6de28a7](https://github.com/gabrielvieiraf/finitemonkey/commit/6de28a7b03bc688d386c59e279538dbcfe2cff9b)), closes [#22](https://github.com/gabrielvieiraf/finitemonkey/issues/22)
* **install:** managed block in AGENTS.md imported from CLAUDE.md, and a doctor line ceiling ([#136](https://github.com/gabrielvieiraf/finitemonkey/issues/136)) ([4cec779](https://github.com/gabrielvieiraf/finitemonkey/commit/4cec779c4a7fe4f330782230fded94bc3081a4fa)), closes [#24](https://github.com/gabrielvieiraf/finitemonkey/issues/24)
* **schema:** publish JSON schemas generated from the types, with add-only tests ([#139](https://github.com/gabrielvieiraf/finitemonkey/issues/139)) ([01e1e2c](https://github.com/gabrielvieiraf/finitemonkey/commit/01e1e2c8bb47c7b3681913929432b599261830e8)), closes [#26](https://github.com/gabrielvieiraf/finitemonkey/issues/26)
* **update:** per-version migrations applied in semver order with backup ([#138](https://github.com/gabrielvieiraf/finitemonkey/issues/138)) ([99e5e1b](https://github.com/gabrielvieiraf/finitemonkey/commit/99e5e1b2f7fbc7ca55d64f8a97c9b6e05094915c)), closes [#19](https://github.com/gabrielvieiraf/finitemonkey/issues/19)

## [0.1.0-next.10](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.9...v0.1.0-next.10) (2026-10-26)

### Features

* **i18n:** full language detection order and the Claude Code language setting ([#132](https://github.com/gabrielvieiraf/finitemonkey/issues/132)) ([44fbd16](https://github.com/gabrielvieiraf/finitemonkey/commit/44fbd16bdcc1a198971bc163b454d089333aa58b)), closes [#17](https://github.com/gabrielvieiraf/finitemonkey/issues/17)
* **i18n:** plural forms, review status per key and per-language generated files ([#133](https://github.com/gabrielvieiraf/finitemonkey/issues/133)) ([a04d053](https://github.com/gabrielvieiraf/finitemonkey/commit/a04d053ac118873de407a977edc2249aefb5ecaf)), closes [#18](https://github.com/gabrielvieiraf/finitemonkey/issues/18)

## [0.1.0-next.9](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.8...v0.1.0-next.9) (2026-10-26)

### Features

* **install:** ask before default-branch pushes and deploys, block reads outside the project ([#131](https://github.com/gabrielvieiraf/finitemonkey/issues/131)) ([816e2fb](https://github.com/gabrielvieiraf/finitemonkey/commit/816e2fb6e6172b0999da887f67fd2f297d29b055)), closes [#51](https://github.com/gabrielvieiraf/finitemonkey/issues/51)

## [0.1.0-next.8](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.7...v0.1.0-next.8) (2026-10-26)

### Features

* **install:** init writes a project verify skill that runs the fast gate ([#130](https://github.com/gabrielvieiraf/finitemonkey/issues/130)) ([2f2fc44](https://github.com/gabrielvieiraf/finitemonkey/commit/2f2fc44dbb07dde6113f65ad7586b4f1573c592d)), closes [#43](https://github.com/gabrielvieiraf/finitemonkey/issues/43)

## [0.1.0-next.7](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.6...v0.1.0-next.7) (2026-10-26)

### Bug Fixes

* **git:** take the user's identity from git var so GIT_AUTHOR_EMAIL counts as their own ([#128](https://github.com/gabrielvieiraf/finitemonkey/issues/128)) ([ca4196a](https://github.com/gabrielvieiraf/finitemonkey/commit/ca4196ad64ac044c7d22709b0d7887f3e93dcd2e))

## [0.1.0-next.6](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.5...v0.1.0-next.6) (2026-10-26)

### Features

* **git:** destructive git guard, snapshot, undo, rescue, merge verify and prod-edit guard ([#120](https://github.com/gabrielvieiraf/finitemonkey/issues/120)) ([67884b4](https://github.com/gabrielvieiraf/finitemonkey/commit/67884b4fd8ec297d8bc415552df08ac7cffe2d94))

## [0.1.0-next.5](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.4...v0.1.0-next.5) (2026-10-26)

### Features

* **prose:** check for machine-written text patterns in docs, commits, PRs and issues ([#36](https://github.com/gabrielvieiraf/finitemonkey/issues/36)) ([683662f](https://github.com/gabrielvieiraf/finitemonkey/commit/683662f809ed3d6915e54d7ae7ec2fb6aaeafb9b))

## [0.1.0-next.4](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.3...v0.1.0-next.4) (2026-10-26)

### Features

* **gate:** done gate with task contract, self-run evidence and test guards ([#20](https://github.com/gabrielvieiraf/finitemonkey/issues/20)) ([32a2372](https://github.com/gabrielvieiraf/finitemonkey/commit/32a237295e68021955148af7fe70804626d48731))

## [0.1.0-next.3](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.2...v0.1.0-next.3) (2026-10-25)

### Features

* **install:** init, update e uninstall com backup e plugin para o claude code ([#11](https://github.com/gabrielvieiraf/finitemonkey/issues/11)) ([abf4d02](https://github.com/gabrielvieiraf/finitemonkey/commit/abf4d022bd601562b07adcbe5b9cdf5986c249b7))

## [0.1.0-next.2](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.1.0-next.1...v0.1.0-next.2) (2026-10-25)

### Features

* **secrets:** trava de segredos na escrita, no comando, no prompt e no commit ([#9](https://github.com/gabrielvieiraf/finitemonkey/issues/9)) ([50d56dd](https://github.com/gabrielvieiraf/finitemonkey/commit/50d56dd5196fa104f28ead05cee7231bb36231a3))

## [0.1.0-next.1](https://github.com/gabrielvieiraf/finitemonkey/compare/v0.0.0...v0.1.0-next.1) (2026-10-25)

### Features

* fundação da cli com contrato json, idiomas, doctor e hooks ([#7](https://github.com/gabrielvieiraf/finitemonkey/issues/7)) ([59520b7](https://github.com/gabrielvieiraf/finitemonkey/commit/59520b77cad9be36af68c355140ad85bceb5b2d9))

### Bug Fixes

* **release:** preset de changelog compatível com o semantic-release ([#8](https://github.com/gabrielvieiraf/finitemonkey/issues/8)) ([43ccefc](https://github.com/gabrielvieiraf/finitemonkey/commit/43ccefc0597380d64c3d11bfc0a0928a825c6cea))
