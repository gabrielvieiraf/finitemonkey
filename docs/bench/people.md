# People study pre-registration

Written before any participant is recruited and before the first session. Issue #251. The commit that merges this file is tagged `people-prereg-<date>` before the first session, and every report prints the sha256 of this file and of `bench/people/protocol.json`. Changes after the first session go in the "Changes" section at the end, with the date, the reason and the sessions they affect.

No data exists yet. The only records in this repository are the synthetic fixtures in `test/fixtures/people-synthetic/`, which were constructed to test the analysis code, carry `"synthetic": true` on every line, and are never results.

## Question

When a person outside the project works on a small real task with Claude Code, does Finite Monkey lower how often they end believing the task is done while it is not, without lowering how many tasks they finish or making them much slower?

Simulated users (`bench/PREREGISTRATION.md`, #127) only screen features. Keeping a claim about real people needs real people: experienced developers were 19% slower with AI while believing they were 20% faster ([METR 2025](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)), and simulated users vary by up to 9 points depending on the model ([arXiv 2601.17087](https://arxiv.org/abs/2601.17087)).

## Participants

- Ten people who have never contributed to Finite Monkey or used it before the study: five **beginners** (have written code for less than a year, or only with an AI assistant) and five **experienced** developers (at least three years of paid software work). The profile is self-reported on the consent form before the slot is assigned.
- Each person needs a computer that can run Node 20 and Claude Code, or uses one prepared by the facilitator.
- Recruitment is open and not yet done: the channel, and any compensation, are recorded in "Changes" before the first session. Compensation never depends on results.

## Design

Within-person and randomized. Every participant does the same four tasks, two with Finite Monkey and two without, in an order fixed by the seed.

| Arm | What runs |
|---|---|
| `plain` | Claude Code as installed, with a fresh config folder. No plugin, no hooks. |
| `fm` | The same, with the Finite Monkey plugin at the commit pinned for this study and its default policy. |

The model, the Claude Code version and the pinned plugin commit are the same for every session and are recorded in "Changes" before the first session.

The tasks are four families from the bench, chosen because each has a trap that a person who does not master the subject can miss while the assistant says done: `cart-total` (a red test that can be loosened instead of fixed), `invoice-tax` (VAT rounded on the total instead of per line), `notes-idor` (another user can edit someone's note) and `timezone-report` (a fixed offset that breaks in summer time). Each session gets its own instance from the task generator, seeded per slot and task.

### Randomization

`npm run bench:people -- schedule` prints the full schedule from `bench/people/protocol.json` (seed 251). It depends only on the seed and the slot id, never on who takes the slot:

- Slots are `B01` to `B05` for beginners and `E01` to `E05` for experienced developers, plus spares `B06` to `B08` and `E06` to `E08`.
- Slots are paired (B01 with B02, B03 with B04, and the odd ones out, B05 and E05, with each other; the same for spares). In each pair, the tasks are split at random into two halves; one member gets Finite Monkey on the first half and the other on the second, and the two members start with opposite arms. Over the ten primary slots, every task is done five times in each arm, and five people start with each arm.
- Within a person, arms alternate, and the order of tasks inside each arm is shuffled.
- A person takes the next free slot of their profile at enrollment, after signing consent.
- A person who withdraws is replaced by the next spare slot of the same profile. The withdrawn slot is kept as a line with `withdrawn: true` and nothing else about the person.

`test/bench-people.test.ts` proves, for four seeds, that every person gets two tasks per arm in alternating order, every task is balanced across arms, and the start arm is balanced.

### Blinding

Participants cannot be blinded: Finite Monkey speaks in the session. Outcomes are scored by the hidden oracle of each task, run after the session by `npm run bench:people -- score`, so nobody judges the work by hand. The analysis code is committed with this file and tested on synthetic data before any real record exists.

## Session procedure

1. The person reads `bench/people/consent.md` (or the Portuguese or Spanish copy), asks any question, and signs. Screen recording is a separate, optional choice, off unless they tick it.
2. The facilitator assigns the next slot and, for each of the four sessions, runs `npm run bench:people -- prepare --slot <slot> --task <task> --out <empty folder outside this repository>`, which writes the starting repository and prints the task card.
3. The person reads `bench/people/instructions.md` (or a translation), gets the task card, and works as they normally would. The facilitator only answers questions about the setup, never about the task.
4. The session ends when the person says it is done, gives up, or reaches 45 minutes. The facilitator writes down which, and the wall time from the first prompt to that moment.
5. After the session the facilitator runs `score` on the folder and records the result. The person is not told whether the oracle passed until all four sessions are over.
6. After the fourth session the person answers one question: "Compared to working without Finite Monkey, how much faster or slower do you think you were with it, in percent? (+ is faster.)"

## Metrics

The metric set comes from the stage 2.5 plan (`docs/bench/stage-2.5.md`, #244), narrowed to what a single supervised session can measure.

| Metric | Definition | Role |
|---|---|---|
| False done | the person said done and the hidden oracle (including the trap check) is red | **primary** |
| Completion | the hidden oracle is green when the session ends, whatever the person said | guardrail |
| Wall time | first prompt to the end of the session, capped at 45 minutes | guardrail |
| Trap green | the trap check passes, for tasks that have one | secondary |
| Tokens | input plus output tokens of the session, from the transcript | secondary, descriptive |
| Perceived against measured speed | the answer to the closing question against the measured change in wall time | secondary, descriptive |
| Dismissals | per Finite Monkey feature, times shown and times the person dismissed or overrode it | per-feature decision |
| Profile | beginner or experienced | subgroup, descriptive only |

Not measured here: rework within 7 days, hook latency and repeat learning, because a supervised session on a generated task has no history after it.

## Hypotheses

- **H1 (primary).** The false done rate is lower with Finite Monkey than without it.
- **H2 (guardrail).** Completion is not lower with Finite Monkey by more than 0.25 (one task in four).
- **H3 (guardrail).** Wall time is not more than 20% longer with Finite Monkey.
- **H4 (exploratory).** People overestimate how much Finite Monkey speeds them up, as in METR 2025.
- **H5 (exploratory).** The effect differs between beginners and experienced developers. With five per group this is reported, never tested.

## Analysis

`npm run bench:people -- analyse --data bench/people/data` writes the report. The plan:

- **Intention to treat.** A session counts in the arm the schedule assigned, even if it ran in the other one; such sessions are listed as deviations. A session that was started is always recorded: giving up or reaching the time cap counts as not done.
- **Unit.** The participant. For each person and metric, the value with Finite Monkey minus the value without it (for wall time, the difference of mean log seconds, reported as a ratio).
- **Primary test.** The mean of the per-person differences in false done rate, a 95% t interval, and an exact two-sided sign-flip test over all 2^n sign assignments. People without a session in both arms are not analysed and are listed.
- **Decision on H1.** Finite Monkey lowered false done only if the whole 95% interval is below zero; raised it if the whole interval is above zero; otherwise "not shown".
- **Guardrails.** H2 is breached when the completion difference estimate is below -0.25; H3 when the wall time ratio estimate is above 1.2.
- **Bundle decision.** Finite Monkey may claim a benefit for people only when H1 is "lowered" and neither guardrail is breached, and the claim always carries n and the raw counts. Any other outcome is published as it is, and the docs do not claim the benefit.
- **Per-feature decision.** For each feature that showed something in the `fm` arm: shown fewer than 5 times in total, "too few showings to judge"; dismissed more than 10% of the times shown, "drop from default"; otherwise "kept on this measure". The study measures the bundle, so no feature is promoted on this study alone.
- **Sample size.** Ten is what is feasible, not what a power calculation asks for. The study can only detect a large effect. "Not shown" means not shown, never "no effect".

The report prints, for every arm and profile, sessions, claimed done, oracle green, false done, trap green, median minutes and tokens, followed by every session as a row, so the raw counts are always next to the estimates.

## Data format

Two JSON Lines files in `bench/people/data/`, written after the sessions. Every line carries `"synthetic": false`; the analysis refuses a file that mixes synthetic and real lines, or a line without the flag.

`participants.jsonl`, one line per slot that was used:

| Field | Type | Meaning |
|---|---|---|
| `synthetic` | boolean | `false` for real records |
| `participant` | string | slot id, such as `B03` |
| `profile` | `beginner` or `experienced` | must match the slot |
| `withdrawn` | boolean | when true, the person's sessions are deleted |
| `recordingConsent` | boolean | whether they agreed to screen recording |
| `perceivedSpeedupPercent` | number or null | answer to the closing question |

`sessions.jsonl`, one line per session:

| Field | Type | Meaning |
|---|---|---|
| `synthetic` | boolean | `false` for real records |
| `participant` | string | slot id |
| `task` | string | task family, must be in the slot's schedule |
| `arm` | `plain` or `fm` | the arm that actually ran |
| `claimedDone` | boolean | the person said the task was done |
| `oracleGreen` | boolean | from `score` |
| `trapGreen` | boolean or null | from `score`, null when the task has no trap check |
| `wallSeconds` | number | first prompt to the end of the session |
| `tokens` | integer or null | input plus output tokens, null when the transcript is missing |
| `stopped` | `done`, `gave-up` or `time-cap` | how the session ended |
| `features` | object | per feature id, `{ "shown": n, "dismissed": n }`; empty in the `plain` arm |

No name, e-mail, prompt text or transcript goes into these files. Transcripts and recordings stay on the facilitator's machine and are deleted when the results are published.

## Known limits

- The schedule is public and fixed by the seed, so allocation is concealed only by assigning slots strictly in order of enrollment.
- The task oracles are public in this repository. Participants are asked not to open the repository during the study, and work in folders outside it.
- Four generated tasks of 45 minutes are not a person's own project. The result says how Finite Monkey does on these tasks, not on long work.
- Task cards come from the task families and are in English. The consent form and the instructions exist in English, Portuguese and Spanish.
- This study has not been reviewed by an ethics committee. Consent, the right to withdraw, and data minimization follow the consent form.

## Publication

The report, the two data files and the decision on each feature are committed together in one PR, whatever they show, including features that did not help. The PR links this file at the tagged commit.

## Changes

None yet.
