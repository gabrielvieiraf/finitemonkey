# Stage 2.5 measurement plan

Written before the first run. Changes to this file after a run starts go in the "Changes" section at the end, with the date and the reason.

## Assignment

- Each feature below reads its mode from `.finitemonkey/policy.yml`. Under `experiments:`, `<feature>: random` turns it on or off per task. The arm comes from a hash of the task id and the feature id, so a task keeps its arm for its whole life.
- The arm is written to `.finitemonkey/log.jsonl` as `experiment_arm` when the task is created. Analysis is by intention to treat: a task counts in the arm it was given, whether or not the feature ever fired in it.
- Tasks without a contract are not assigned. Damage guards (secrets, gate, git, rules) are never in an experiment.

## Metrics

| Metric | Definition | Source |
|---|---|---|
| Completion | the task has a passing gate and its commit is not reverted within 7 days | evidence ledger, `git log` |
| Gate failures | failed gate runs per task | evidence ledger |
| Wall time | first evidence entry to first passing gate | evidence ledger |
| Tokens | input and output tokens per task, subagents included | session transcripts |
| Hook latency | p95 per hook event, per arm | `test/hook-latency.test.ts` harness on the same machine |
| Dismissal rate | dismissals divided by times shown, per detector or rule | `slop.json`, `suggestions.jsonl`, `log.jsonl` |
| Rework | reverted lines within 7 days | `git log` |
| Repeat learning | a later task on the same concept done without the explanation, passing its gate | concept book, evidence ledger |

## Hypotheses, one primary metric each

| Feature | Hypothesis | Primary metric | Guardrails |
|---|---|---|---|
| reminders | fewer violations of reminder rules | violations per 100 tasks | tokens, hook p95 |
| learnings | the same error signature returns less often | repeats per signature | tokens |
| rules-stop | fewer process-rule violations reach the end of a task | violations caught after Stop | dismissal rate |
| quality | fewer metric regressions on touched code | regressions per 100 tasks | wall time, dismissal rate |
| slop | fewer AI code tics merged | tics per 100 tasks | dismissal rate under 10% per detector |
| tests-hold, regression | fewer weakened or unproven tests | test edits approved vs rejected, fixes whose test failed on base | wall time |
| advisor | accepted suggestions improve their metric without reverts | metric change on accepted suggestions | dismissal rate, reverts |
| claims | fewer completion claims without a passing gate | claims not confirmed per 100 tasks | wall time |
| clarify | more tasks reach a passing gate | completion | questions per task |

A feature is kept when its primary metric moves in the expected direction with the 95% interval excluding zero, and no guardrail gets worse past its limit: hook p95 over 100 ms per handler, dismissal rate over 10%, or wall time up more than 20%.

## Runs

1. Simulated users (`bench`, #125 to #127) only to screen features and catch regressions. No feature is kept on simulated results alone.
2. Real sessions with `experiments:` set to `random`, until each arm of a feature has at least 30 tasks.
3. A hand audit of 10 completed tasks per arm, checking that a passing gate means the work is done, to catch gaming of the gate.

## Report

`finitemonkey gain --by-arm` lists, per feature and arm, tasks, completed tasks, gate runs, failed gate runs and the median gate time. The other metrics come from the bench harness. Results are published as they come out, including features that did not help.

## Changes

None yet.
