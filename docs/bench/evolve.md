# Stage 6: policy variants, calibration and unattended runs

Each feature reads its mode from `.finitemonkey/policy.yml`, starts in shadow and can be assigned at random per task under `experiments:`. No verdict comes from a model, and nothing here calls one.

## evolve: policy variants per person

- Only policy changes: a guard's mode and the alert budget's `muteAbove`. Code, hooks and damage guards (`secrets`, `gate`, `git`, `rules`) never change. Keys the person set in `policy.yml` are never overridden.
- `finitemonkey policy evolve` runs at Stop in the background, at most every 10 minutes. It proposes variants from the local record: a guard whose warnings were dismissed in 30% or more of at least `alertBudget.minFirings` firings gets a shadow variant; warning classes dismissed at a rate between half the mute threshold and the threshold get a variant with half the threshold. At most three variants are on trial, one per target, and a change once tried is never proposed again.
- A variant is born on the active task. That task never counts for it. Every later task is assigned to the variant or to the parent by a hash of the task id and the variant id; the variant applies only on its arm and only while `evolve` is `active`. Tasks that ran in shadow are recorded but never counted.
- A variant is judged once both arms have `evolve.minTasks` finished tasks (default 10, initial calibration). Per task, from the signed ledger: false done (a gate passed and a later gate failed, or the task was invalidated), dismissals logged during the task, and wall time to the first passing gate. The variant is promoted when it is no worse on all three and better on one; otherwise it is rejected. Tasks with tampered ledger lines are left out.
- The variant records the digest of the gate scripts and hooks when it is born. If the current digest or the digest on any counted gate line differs, no variant is promoted or rejected until the person reverts it.
- A promotion is shown once at the next prompt with the numbers and the revert command. `policy history` lists every variant; `policy revert <id>` works only from a terminal outside Claude Code. Lessons learned during a task on a trial variant are quarantined until the person accepts them.

Not covered: reminder sets as a variant target, CI and hidden oracles as the judge (the local signed gate is the judge here), and selection by the performance of descendants. Ten tasks per arm detects only large differences; the numbers are shown, not tested for significance.
