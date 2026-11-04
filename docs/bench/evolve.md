# Stage 6: policy variants, calibration and unattended runs

Each feature reads its mode from `.fm/policy.yml`, starts in shadow and can be assigned at random per task under `experiments:`. No verdict comes from a model, and nothing here calls one.

## evolve: policy variants per person

- Only policy changes: a guard's mode, the alert budget's `muteAbove`, and the reminder set (whether a reminder rule is injected). Code, hooks and damage guards (`secrets`, `gate`, `git`, `rules`) never change. Keys the person set in `policy.yml` are never overridden.
- `fm policy evolve` runs at Stop in the background, at most every 10 minutes. It proposes variants from the local record: a guard whose warnings were dismissed in 30% or more of at least `alertBudget.minFirings` firings gets a shadow variant; warning classes dismissed at a rate between half the mute threshold and the threshold get a variant with half the threshold; a reminder rule injected at least `alertBudget.minFirings` times and never violated gets a variant that withholds it. At most three variants are on trial, one per target, and a change once tried is never proposed again.
- A variant is born on the active task. That task never counts for it. Every later task is assigned to the variant or to the parent by a hash of the task id and the variant id; the variant applies only on its arm and only while `evolve` is `active`. Tasks that ran in shadow are recorded but never counted.
- A variant is judged once both arms have `evolve.minTasks` finished tasks (default 10, initial calibration). Per task, from the signed ledger: false done (a gate passed and a later gate failed, or the task was invalidated), dismissals logged during the task, and wall time to the first passing gate. The variant is promoted when it is no worse on all three, better on one, and the pre-stated test passes: the 95% Welch interval of the per-task difference (variant minus parent) lies below zero for at least one of the three. A difference whose interval includes zero is rejected, however good the means look. Tasks with tampered ledger lines are left out.
- The variant records the digest of the gate scripts and hooks when it is born. If the current digest or the digest on any counted gate line differs, no variant is promoted or rejected until the person reverts it.
- Variants stay in an archive (`.fm/cache/evolve.json`). A new variant records as its parent the latest promoted variant on the same target that beat its own parent.
- A promotion is shown once at the next prompt with the numbers and the revert command. `policy history` lists every variant; `policy revert <id>` works only from a terminal outside Claude Code. Lessons learned during a task on a trial variant are quarantined until the person accepts them.

Not covered: CI and hidden oracles as the judge (the local signed gate is the judge here). Ten tasks per arm detects only large differences, so most variants will be rejected by the interval until more tasks accumulate.

## calibrate: when to ask, from local labels

- Inputs, and only these: divergence (a `task diverge` run for the task asked a question), the share of contract criteria marked decorative by mutants, and the share of bad tasks among earlier finished tasks in the same area. No text written by the model is read, and no confidence field in any log line counts.
- Labels: a finished task is bad when a gate passed and a later gate failed, the task was invalidated, or a commit starting with "Revert" touched its scope within 7 days of its last evidence. A divergence question asked in active mode and never answered counts as dismissed: when the task later stays green the question is labeled not needed (target 0), and when its scope is reverted it is labeled needed (target 1). `calibrate refit` logs both counts.
- Below `calibrate.minLabels` (default 30) the fixed rule decides: ask when the readings diverged, run otherwise. From there a logistic model per repository, fitted on the labels, decides: ask at 0.25 or more, abstain at 0.6 or more (`calibrate.askAbove`, `calibrate.abstainAbove`). All three numbers are initial calibration.
- `calibrate refit` runs at Stop in the background, at most every 10 minutes, and caches the state of each open task. When the person trusts a contract, the state appears as a color (green run, yellow ask, red abstain), never as a number. `calibrate explain [<task>]` lists the inputs, their weights and the label count.

## autonomy: unattended runs sized by the local p80 horizon

- `fm run --unattended <task>` estimates the contract from its reference class (the median of finished tasks of the same size and area, as in `guardian forecast`), or from its size when there are fewer than five: 30, 120 and 480 minutes for S, M and L.
- The local horizon is the longest time to the first passing gate at which at least 80% of the shorter finished tasks had no false done, from five tasks on. With less history it is the published horizon (`autonomy.publishedHorizonMinutes`, default 60) times `autonomy.margin` (default 0.5). All these numbers are initial calibration.
- A contract over the horizon is split into as many subcontracts as it needs, each taking a share of the acceptance checks, its own file under `.fm/tasks/` and its own gate. If it needs more parts than it has checks, the run is refused.
- Every subcontract file is written, trusted and hashed before the first part starts. A part whose file changed during the run is invalidated. A part whose gate does not pass stops the chain; the rest are reported unproven.
- While the run is on, a hold outside the policy blocks `git push`, `reset`, `clean`, `rebase`, forced branch deletion, recursive `rm`, production clients (`ssh`, `psql`, `kubectl` and the rest of the production list), publishing and deploy tools, and the destructive SQL, Terraform and kubectl commands the git guard already knows. It cannot be set to off.
- The time cap (`autonomy.maxMinutes`, default 120) and the spend cap (`autonomy.maxUsd`, default 5, from the local spend ledger) are checked before each part. The morning report in `.fm/reports/unattended-<run>.json` lists proven, unproven and invalidated parts and every hold.
- Finite Monkey never calls a model here. The agent is a command the person sets as `autonomy.agent` in `.fm/config.yml`; it receives the part as JSON on stdin. Without it, or while the autonomy feature is not active, the command prints the plan and starts nothing. Only the person starts a run, from a terminal outside Claude Code.

Not covered: properties and oracle hashes beyond the contract and examples files, and per-size-class statistics for the measure.
