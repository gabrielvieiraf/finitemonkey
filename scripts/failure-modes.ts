export interface FailureMode {
  readonly failure: string;
  readonly cause: string;
  readonly mitigation: string;
  readonly file: string;
  readonly test: string;
}

export const FAILURE_MODES: readonly FailureMode[] = [
  {
    failure: "The agent says done while checks fail",
    cause: "The model reports success from its own reading of the work",
    mitigation: "The `Stop` hook runs the gate and blocks with the list of what is missing",
    file: "test/stop.test.ts",
    test: "blocks with the list of what is missing, as facts for the model",
  },
  {
    failure: "A blocked stop loops forever",
    cause: "Every stop attempt is blocked again",
    mitigation: "Blocking ends before Claude Code's own continuation cap with a visible NOT DONE",
    file: "test/stop.test.ts",
    test: "stops blocking before Claude Code's own continuation cap",
  },
  {
    failure: "A gate that cannot run looks like a pass",
    cause: "A crash, a missing file or an unwritable ledger",
    mitigation:
      "The stop is held once with GATE DID NOT RUN, then let through recorded as not run; `pr open` and `ci gate` refuse until a real run passes",
    file: "test/stop.test.ts",
    test: "when the gate cannot run (an unwritable ledger), the stop is held once, then let through as not run",
  },
  {
    failure: "Old evidence passes new code",
    cause: "A check passed, then the tree changed",
    mitigation: "Evidence is tied to the tree hash; any edit after green runs the check again",
    file: "test/gate.test.ts",
    test: "evidence from another tree is stale: an edit after green runs the check again",
  },
  {
    failure: "A check that never ran counts as passed",
    cause: "The tool is missing from the machine",
    mitigation: "The check is reported as not verified, never as passed",
    file: "test/gate.test.ts",
    test: "a missing tool is not verified, never passed",
  },
  {
    failure: "Old failures block unrelated work",
    cause: "The project was red before the task started",
    mitigation: "A baseline taken at session start; only new failures block",
    file: "test/gate.test.ts",
    test: "only new failures block: the baseline keeps old failures out",
  },
  {
    failure: "Tests are skipped to make the suite pass",
    cause: "The agent adds `.skip` or `xit` through any tool",
    mitigation: "The tests check reads the tree diff, not the tool call",
    file: "test/gate.test.ts",
    test: "the tests check catches a skip added through any tool, from the tree diff",
  },
  {
    failure: "A secret is committed",
    cause: "A credential is staged with the change",
    mitigation: "`git commit` is blocked with the file and line",
    file: "test/secrets-guards.test.ts",
    test: "git commit with a staged secret is blocked with file and line",
  },
  {
    failure: "A block message repeats the secret it blocked",
    cause: "Messages quote the offending text",
    mitigation: "Messages name the rule and the masked last four characters only",
    file: "test/mask.test.ts",
    test: "a blocked hook names the rule and never echoes the value",
  },
  {
    failure: "The agent turns the guards off",
    cause: "An edit removes the hooks from the settings",
    mitigation: "The change is blocked until the person releases it",
    file: "test/session.test.ts",
    test: "blocks a change that removes Finite Monkey hooks",
  },
  {
    failure: "The agent grants itself a permission",
    cause: "The agent writes to the allow store",
    mitigation: "The allow store is not writable from a tool call",
    file: "test/hook-compose.test.ts",
    test: "the allow store is never writable, even with a self grant",
  },
  {
    failure: "A fake approval reaches the gate",
    cause: "An approval marker arrives inside a background notification",
    mitigation: "Only markers typed by the person count",
    file: "test/session.test.ts",
    test: "ignores markers that arrive inside a background notification",
  },
  {
    failure: "A hook hangs the session",
    cause: "Stdin never closes",
    mitigation: "A timer stops the hook",
    file: "test/hook.test.ts",
    test: "a real timer stops a hook whose stdin never closes",
  },
  {
    failure: "Bad hook input lets the gate through",
    cause: "Stdin is not valid JSON",
    mitigation: "The gate blocks and explains in the user's language",
    file: "test/hook.test.ts",
    test: "bundle blocks a gate when stdin is garbage, in the user's language",
  },
];
