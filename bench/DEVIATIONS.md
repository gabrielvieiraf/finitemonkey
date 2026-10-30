# Deviations

Every change to the method after `PREREGISTRATION.md` was frozen goes here, newest last: the date, what changed, why, and which runs it affects. A deviation never edits the frozen file.

## 2026-10-30, before the pilot

- Arms pinned to f3652fcc, the release 0.1.0-next.41 that brings Stages 3.5 to 6 (#356), one day after the file was frozen. Reason: the plugin under test changed after the freeze date; the pin is the released code. Affects every run.
- No held-out partition in this round: nobody outside development has written one yet. Results are reported on the public tasks only and say so.
- Persona calibration (people outside development labelling final messages) has not happened before the pilot. All personas are reported as uncalibrated until it does.
- Isolation: runs use a fresh temporary folder outside any repository and a dedicated config dir, but run as the same OS user that owns this repository, so an agent that searched the disk could reach the public oracles. Transcripts of the pilot are read for any access to the repository path; a run that touched it is excluded and reported.
- Model: `sonnet`, through an API key with a fixed credit budget; `--max-budget-usd` per turn is set from the pilot's measured cost so the primary phase fits the budget, and the value used is recorded with each run.
