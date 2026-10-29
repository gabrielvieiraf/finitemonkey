# Bench pre-registration

Written before the first run. The SHA-256 of this file and the date it was frozen are in `PREREGISTRATION.lock.json`, and `npm run bench` refuses to start when the file no longer matches. Any change after the freeze goes in `DEVIATIONS.md` with the date, the reason and the runs it affects. The freeze commit is tagged `bench-prereg-<date>` before the pilot.

## Question

Does a Claude Code session with Finite Monkey end with fewer false "done" claims than the same session without it, at what cost in tokens and wall time, and without finishing fewer tasks?

A second question comes from the ricochet design (#284): does horizon help that must name a judgment criterion keep the gain in finished tasks that horizon help brings, while letting fewer errors through?

## Arms

Each arm is a file in `arms/`. A Finite Monkey arm pins the commit of the plugin it runs (`sha`), and the harness refuses to run an arm whose `sha` is empty. The pins are set in the freeze commit, before the pilot.

| Arm | What runs |
|---|---|
| `plain` | Claude Code as installed. No plugin, no hooks. Always present. |
| `fm` | The Finite Monkey plugin with its default policy. |
| `no-detector` | The plugin with `ricochete` and `clarify` off. |
| `horizon` | The plugin with `ricochete` in shadow: horizon help is given, and an answer without a judgment criterion is logged, not held. |
| `horizon-criterion` | The plugin with `ricochete` active: Stop holds a horizon answer that names no criterion. |

Known limit of the ricochet arms: the ricochete skill ships in the plugin, so its description is visible in all three. The arms differ in what the Stop hook holds and whether clarify runs.

## Tasks

Tasks live in `tasks/`, one folder each. A task carries a prompt, a starting repository, a hidden oracle and reference solutions. The harness copies only the starting repository into the run folder.

## Simulated users

A run without a persona gets the task prompt alone and no follow-up.

## Definitions

- **Run:** one `claude -p` session for one task, one arm and one repeat.
- **Claimed done:** the last assistant message matches the completion claim detector of `src/claims/detect.ts`.
- **Oracle green:** every hidden oracle check of the task passes on the final tree of the run.
- **False done (primary metric):** claimed done and oracle red. In Finite Monkey arms the subset where the gate was also green is reported apart.
- **Finished:** oracle green.
- **Cost:** `total_cost_usd`, input and output tokens (cache reads included) from the session result, and wall time from process start to exit.
- **pass^k:** a task counts only when all k repeats of the arm finished it.
- **Mergeable without edits:** a reviewer outside development reads the diff of an oracle-green run and would merge it as is. Judged on a random sample of 10 oracle-green runs per arm, blind to the arm.

## Hypotheses

| Id | Hypothesis | Metric | Direction |
|---|---|---|---|
| H1 | Finite Monkey lowers false done | false done per run, `fm` against `plain` | lower |
| H2 | Finite Monkey does not finish fewer tasks | finished per run | not lower by more than 10 points |
| H3 | Overhead stays bounded | tokens, cost and wall time per run | reported; wall time up more than 20% is a guardrail breach |
| H8a | Horizon help finishes more tasks and lets more errors through | finished and false done, `horizon` against `no-detector` | both higher |
| H8b | A required criterion keeps the gain with fewer errors | finished and false done, `horizon-criterion` against `horizon` | finished not lower, false done lower |

Perceived speed and measured speed are reported separately. Earlier field estimates of a slowdown are not used as a prior: the METR follow-up of February 2026 reports intervals that cross zero.

## Sample and power

The decided budget is 50 to 100 sessions in total, run as real development of this package where possible.

| Phase | Tasks | Arms | Repeats | Sessions |
|---|---|---|---|---|
| Pilot | 2 | all 5 | 1 | 10 |
| Primary | 12 | `plain`, `fm` | 3 | 72 |
| Ricochet | 3 ambiguous | `no-detector`, `horizon`, `horizon-criterion` | 2 | 18 |

Pilot runs are excluded from the analysis. With 12 tasks as clusters and a task-level standard deviation of the paired difference near 0.35, the smallest effect on false done detectable at 80% power and alpha 0.05 is about 30 points. Smaller differences are reported as inconclusive, not as absence of effect. The ricochet phase is exploratory at this size.

## Procedure

1. Freeze this file, pin the arms, tag the commit.
2. `npm run bench -- --seed <n> --dry-run` prints the schedule. The real run needs `--yes` from a person at a terminal and a dedicated `--config-dir` (logged in, no `CLAUDE.md`).
3. Each run gets a fresh temporary folder outside any repository. The task repository is copied and committed there. Arm policy goes in `.finitemonkey/policy.yml`.
4. `claude -p` runs with `--plugin-dir` set to the pinned plugin, hooks injected through `--settings` with the run id in their argv (`--bench-run <id>`), `CLAUDE_CONFIG_DIR` set to the dedicated config, auto memory off, Bash enabled, `--max-budget-usd` per session, and `--output-format stream-json`.
5. Arms are interleaved per task: for each repeat and each task, the arm order is shuffled by the seed. Both arms of a pair get the same task seed.
6. The record of each run keeps the run id, arm and its sha, the hash of this file, the requested and reported model, the Claude Code version, exit code, cost, tokens and the injection check.
7. In the pilot, one transcript per arm is read by hand and checked against the automatic injection check (hooks that ran with the run id, plugin loaded or absent).
8. Any run can be repeated with `npm run bench -- --seed <n> --only <run id> --yes`.

## Analysis

- Paired by task and repeat. Differences are averaged per task first, and the standard error is clustered by task.
- Every result carries n, the 95% interval, pass@1, pass^3 and cost.
- Nothing is promoted on a difference under about 3 points, whatever its interval: single-run pass@1 varies by 2.2 to 6.0 points from noise alone.
- TypeScript and Python tasks are reported separately as well as together.
- A feature is kept only under the rule of `docs/bench/stage-2.5.md`: the primary metric moves in the expected direction with the interval excluding zero, and no guardrail breaks. Simulated runs alone never keep a feature.

## Stopping rules

- Stop the round when the session cap of the phase is reached.
- Stop and record a deviation when the injection check fails on any run, when a hook times out on more than 2 runs of an arm, or when a run reaches outside its folder.
- No interim look at arm differences before the primary phase ends.

## Publication

Results are published with the run records, the transcripts of the pilot, the deviations and the analysis script, whatever the outcome, including arms that did worse.
