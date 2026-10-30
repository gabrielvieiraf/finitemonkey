import type { Threat } from "./threat-model.js";

export const hooks: readonly Threat[] = [
  {
    component: "Command hooks",
    attacker: "process able to edit the guard",
    threat: "The agent removes the Finite Monkey hooks or sets `disableAllHooks` in a settings file",
    outcome: "prevented",
    mechanism:
      "The `ConfigChange` hook compares the hook count with the last census and blocks until the person types a release",
    code: ["src/gate/hooks/config.ts"],
    proof: { file: "test/session.test.ts", test: "blocks disableAllHooks and lets ordinary edits through" },
  },
  {
    component: "Command hooks",
    attacker: "process able to edit the guard",
    threat: "The agent writes to `.finitemonkey/` through a tool call",
    outcome: "reduced",
    mechanism:
      "The self guard blocks Edit and Write there and shell writers it can parse (`rm`, `cp`, `sed -i`, redirects, inline `node -e`); a script file run by an interpreter is not read",
    code: ["src/guards/self/protected.ts"],
    proof: { file: "test/hook-compose.test.ts", test: "the allow store is never writable, even with a self grant" },
  },
  {
    component: "Command hooks",
    attacker: "process able to edit the guard",
    threat: "A process outside Claude Code rewrites the hook entry points or the gate scripts",
    outcome: "detected",
    mechanism:
      "Evidence is reused only while the hook entry points and gate scripts hash the same; otherwise the checks run again",
    code: ["src/gate/scripts-digest.ts"],
    proof: {
      file: "test/ledger-hmac.test.ts",
      test: "a modified hook script makes the gate run the checks again instead of reusing evidence",
    },
  },
  {
    component: "Command hooks",
    attacker: "process able to edit the guard",
    threat: "Someone with a shell deletes `.finitemonkey/`",
    outcome: "not covered",
    mechanism:
      "The gate finds no evidence and runs every check again, but backups, incidents and approvals stored there are gone",
    code: ["src/task/paths.ts"],
  },
  {
    component: "Command hooks",
    attacker: "concurrent process",
    threat: "Another editor or another agent without hooks changes files during the session",
    outcome: "detected",
    mechanism: "Hooks run only inside Claude Code; the next gate reads the tree diff, not the tool call",
    code: ["src/guards/tests/tree.ts"],
    proof: {
      file: "test/gate.test.ts",
      test: "the tests check catches a skip added through any tool, from the tree diff",
    },
  },
  {
    component: "Command hooks",
    attacker: "wrong tool output",
    threat: "Hook input never closes or is not valid JSON",
    outcome: "prevented",
    mechanism: "A timer stops the hook, and a gate with unreadable input blocks with the reason",
    code: ["src/hooks/runner.ts", "src/hooks/stdin.ts"],
    proof: { file: "test/hook.test.ts", test: "bundle blocks a gate when stdin is garbage, in the user's language" },
  },
  {
    component: "Command hooks",
    attacker: "wrong tool output",
    threat: "A guard crashes",
    outcome: "recorded",
    mechanism: "Advisory guards fail open and log `guard_failed_open`; damage guards fail closed",
    code: ["src/hooks/failure-modes.ts", "src/policy/policy.ts"],
    proof: {
      file: "test/policy.test.ts",
      test: "an advisory guard that crashes fails open and logs it; a damage guard is left to fail closed",
    },
  },
  {
    component: "Command hooks",
    attacker: "inconsistent policy",
    threat: "`policy.yml` turns the damage guards off",
    outcome: "prevented",
    mechanism: "Damage guards stay active whatever the policy says",
    code: ["src/policy/policy.ts"],
    proof: {
      file: "test/policy.test.ts",
      test: "a secret write and a skipped test still block with every guard set to off",
    },
  },
  {
    component: "Command hooks",
    attacker: "inconsistent policy",
    threat: "The user-level policy weakens what the project set",
    outcome: "prevented",
    mechanism: "The user level can only raise a guard or fill what the project leaves out",
    code: ["src/policy/policy.ts"],
    proof: {
      file: "test/policy.test.ts",
      test: "the user level cannot weaken the project, can raise it, and sets what the project leaves out",
    },
  },
  {
    component: "Command hooks",
    attacker: "inconsistent policy",
    threat: "Instruction files point at deleted scripts or contradict the repository",
    outcome: "detected",
    mechanism: "`finitemonkey instructions` and `doctor` report the line, the file and the commit that wrote it",
    code: ["src/instructions"],
    proof: {
      file: "test/instruction-drift.test.ts",
      test: "reports a reference to a deleted script with file, line and the commit that wrote it",
    },
  },
];

export const mod: readonly Threat[] = [
  {
    component: "The mod",
    attacker: "bypassing agent",
    threat: "Another mod approves a call a Finite Monkey guard denied",
    outcome: "detected",
    mechanism:
      "A `PostToolUse` for a call denied at `PreToolUse` is written to `bypasses.jsonl`; `ci gate` and `pr open` refuse until the person runs `bypass review`. Proven with the scripted Claude Code double; whether `PostToolUse` fires after a mod approves over a `PreToolUse` deny is not confirmed in a real session",
    code: ["src/guards/bypass/ledger.ts", "src/commands/gate.ts"],
    proof: {
      file: "test/bypass.test.ts",
      test: "a call a guard denied that still runs is recorded, and ci gate refuses until the person reviews it",
    },
  },
  {
    component: "The mod",
    attacker: "over-privileged process",
    threat: "An installed mod hooks `tool.check` or `tool.call` and can answer before Finite Monkey",
    outcome: "detected",
    mechanism: "`doctor` reads each mod's reach from `claude plugin validate` and names the mod and the fix",
    code: ["src/doctor/mods.ts"],
    proof: { file: "test/bypass.test.ts", test: "names a mod that hooks tool.check and how to put finitemonkey first" },
  },
  {
    component: "The mod",
    attacker: "wrong tool output",
    threat: "The mod's own permission check throws or times out",
    outcome: "prevented",
    mechanism: "The mod's `tool.check` registration denies the call when a guard throws",
    code: ["src/mod/tighten-hooks.ts"],
    proof: { file: "test/mod/tighten.test.ts", test: "a guard that throws denies the call" },
  },
  {
    component: "The mod",
    attacker: "inconsistent policy",
    threat: "The mod loosens a decision the command hooks made",
    outcome: "prevented",
    mechanism: "The mod only tightens: it never answers allow on its own",
    code: ["src/mod/tighten.ts"],
    proof: {
      file: "test/mod-tighten.test.ts",
      test: "never loosens and never answers allow on its own, for every pair of decisions",
    },
  },
  {
    component: "The mod",
    attacker: "process able to edit the guard",
    threat: "The mod is removed or does not load",
    outcome: "prevented",
    mechanism: "The command hooks carry every guard and the gate on their own",
    code: ["plugin/hooks/hooks.json"],
    proof: {
      file: "test/mod-adapter.test.ts",
      test: "with the mod removed, a guard still blocks and the gate still stops a false done",
    },
  },
];

export const ledger: readonly Threat[] = [
  {
    component: "Signed ledger and its key",
    attacker: "bypassing agent",
    threat: "The agent appends a passed line for the current tree",
    outcome: "detected",
    mechanism:
      "Every line carries an HMAC with a key in `~/.finitemonkey/ledger.key`; a line without a valid signature is ignored and reported",
    code: ["src/evidence/sign.ts", "src/evidence/ledger.ts"],
    proof: {
      file: "test/ledger-hmac.test.ts",
      test: "a hand-written passed line is ignored and reported as tampering",
    },
  },
  {
    component: "Signed ledger and its key",
    attacker: "bypassing agent",
    threat: "The agent reads the signing key with Read or `cat`",
    outcome: "reduced",
    mechanism:
      "The secrets guard treats `*.key` files as sensitive and blocks the read; a program the agent writes and runs can still read the file",
    code: ["src/secrets/guards/paths.ts"],
    proof: {
      file: "test/secrets-guards.test.ts",
      test: "a Read or cat of the ledger signing key is blocked like any key file",
    },
  },
  {
    component: "Signed ledger and its key",
    attacker: "over-privileged process",
    threat: "A process running as the same user signs lines with the key",
    outcome: "not covered",
    mechanism:
      "The key is a file readable by the user; signing raises the cost of tampering and does not prevent it from a process with the user's rights",
    code: ["src/evidence/sign.ts"],
  },
  {
    component: "Signed ledger and its key",
    attacker: "process able to edit the guard",
    threat: "The key is deleted",
    outcome: "detected",
    mechanism: "A new key is created and evidence signed with the old one counts as not run",
    code: ["src/evidence/sign.ts"],
    proof: {
      file: "test/ledger-hmac.test.ts",
      test: "a missing key is created again and the old evidence is not trusted",
    },
  },
];
