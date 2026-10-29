# Guardian measurement plan

Written before the first run. Changes after a run starts go in the "Changes" section at the end, with the date and the reason.

## Assignment

- Each guardian feature reads its mode from `.finitemonkey/policy.yml` and starts in shadow: it computes and logs, but shows nothing and holds nothing until the person sets it to `active` or it is promoted.
- Under `experiments:`, `<feature>: random` assigns each task to an arm by a hash of the task id and the feature id, as in the [stage 2.5 plan](stage-2.5.md). Analysis is by intention to treat.
- No verdict comes from a model. Every trigger is a deterministic rule over files, the diff, the ledger or the contract.

## Hypotheses, one primary metric each

| Feature | Hypothesis | Primary metric | Guardrails |
|---|---|---|---|
| decision-hold | fewer decision records accepted without the person | records reaching `accepted` without `decide accept`, per 100 records | holds dismissed |
| assumptions | more high-impact assumptions verified before the step that depends on them | assumptions verified before vs after the dependent step; assumptions later found false | holds per 100 tasks, wall time |
| reality | level 1-3 reports change the final decision only when it was wrong | precision of level 2-3 reports judged later; harmful redirects (advice followed, then reverted) | dismissals, wall time |
| guardian-reuse | fewer second implementations of a role the project already covers | reports per 100 tasks; accepted reuse vs new code kept | dismissals |
| proportionality | H1: accepted changes over the stage budget have more reverts, rework and incidents; H2: concepts nobody demonstrated predict them better than size | reverts and rework within 30 days per arm; then time to milestone and harmful redirects (followed the simpler option and had to rebuild) | dismissals, wall time |

A feature is kept when its primary metric moves in the expected direction with the 95% interval excluding zero and no guardrail gets worse past its limit: hook p95 over 100 ms per handler, dismissal rate over 10%, or wall time up more than 20%. Thresholds written in the code are initial calibration and can be changed in the policy or config file.

| forecast | a forecast from the person's own comparable tasks errs less than the model's estimate | absolute error of the forecast vs the model estimate on the same tasks | prompts with a forecast, dismissals |
| research log (command output, no hook) | research ends when new sources stop changing the likely answer, without dropping open critical unknowns | sources per decision; sources logged as changing nothing; decisions revisited later | stop notes ignored |

## Discard rules

- proportionality: if H1 shows no difference in the shadow period, the token budget is dropped and only the reversibility trigger stays. If H2 does not predict, demonstrated concepts leave the weight. If the report only delays without fewer incidents or less rework, it goes back to level 1.
- forecast: no forecast below five comparable finished tasks (same size, overlapping area); escalation at twice the reference median. Both numbers are initial calibration.
- research log: two sources in a row that change nothing; a high-risk decision needs two sources from different hosts per critical unknown. Initial calibration.
- The per-stage budget (1, 1, 2, 3 tokens for idea, first customers, growing, stable) and the 10-minute scan interval are initial calibration.

## Changes

None yet.
