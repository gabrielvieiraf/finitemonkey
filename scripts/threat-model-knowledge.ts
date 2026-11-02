import type { Threat } from "./threat-model.js";

export const knowledge: readonly Threat[] = [
  {
    component: "Quarantine of external content and memory",
    attacker: "injected content",
    threat: "Text from a web page or an MCP tool tries to steer the agent",
    outcome: "reduced",
    mechanism:
      "Content Finite Monkey passes on is wrapped as data with its source; the model can still follow text it read",
    code: ["src/policy/untrusted.ts"],
    proof: { file: "test/injection.test.ts", test: "the block names its source and says it is not instructions" },
  },
  {
    component: "Quarantine of external content and memory",
    attacker: "injected content",
    threat: "A lesson written after reading a web page is injected into later sessions",
    outcome: "prevented",
    mechanism: "The lesson stays in quarantine until the person accepts it",
    code: ["src/learnings/store.ts"],
    proof: {
      file: "test/injection.test.ts",
      test: "a lesson written after reading a web page is quarantined and not injected until the person accepts it",
    },
  },
  {
    component: "Quarantine of external content and memory",
    attacker: "injected content",
    threat: "An instruction from a fetched page is written into Claude Code's own memory",
    outcome: "prevented",
    mechanism: "The memory hook refuses instruction-shaped lines from a session that read external content",
    code: ["src/knowledge/memory-hook.ts"],
    proof: {
      file: "test/memory-injection.test.ts",
      test: "never lets an instruction-shaped line from a fetched page reach native memory",
    },
  },
  {
    component: "Quarantine of external content and memory",
    attacker: "injected content",
    threat: "Hidden Unicode characters carry an instruction in `CLAUDE.md`",
    outcome: "detected",
    mechanism: "The file, line and code point are reported",
    code: ["src/policy/untrusted.ts"],
    proof: {
      file: "test/injection.test.ts",
      test: "a hidden-character instruction in CLAUDE.md is reported with file, line and code point",
    },
  },
  {
    component: "Quarantine of external content and memory",
    attacker: "injected content",
    threat: "After reading a web page or an MCP tool output, the agent pushes, sends data out or deploys",
    outcome: "recorded",
    mechanism:
      "`untrusted-outward` starts in shadow and logs `untrusted_outward`; when active, push, sends, publish and deploy in the same session ask the person and name the source",
    code: ["src/guards/outward/hook.ts", "src/guards/outward/classify.ts"],
    proof: {
      file: "test/untrusted-outward.test.ts",
      test: "after a WebFetch, git push asks the person in active mode and names the source",
    },
  },
  {
    component: "Quarantine of external content and memory",
    attacker: "mistaken agent",
    threat: "A lesson about a file that changed since it was learned is still injected",
    outcome: "prevented",
    mechanism:
      "Lessons carry the hash of the files they name; a changed file marks the lesson stale until the person accepts it",
    code: ["src/learnings/tree.ts"],
    proof: {
      file: "test/lesson-tree.test.ts",
      test: "a lesson whose file changed is not injected until the person confirms it",
    },
  },
  {
    component: "Quarantine of external content and memory",
    attacker: "injected content",
    threat: "An MCP tool description changes after the tool was trusted",
    outcome: "detected",
    mechanism:
      "`finitemonkey mcp pin` reports a changed description once; with `mcp-pin` active a call to the tool asks the person until `mcp confirm`. Nothing feeds the pin from a live session yet",
    code: ["src/policy/mcp-pins.ts", "src/policy/mcp-pin-hook.ts"],
    proof: {
      file: "test/mcp-pins.test.ts",
      test: "a changed description is reported once and the tool stays untrusted until the person confirms",
    },
  },
  {
    component: "Quarantine of external content and memory",
    attacker: "injected content",
    threat: "An instruction hidden in HTML, a Markdown comment, zero-width text, tool output, PDF text or alt text",
    outcome: "prevented",
    mechanism:
      "Every case of the corpus is refused from native memory and from claims, and stays readable inside the data block",
    code: ["src/knowledge/instruction.ts"],
    proof: { file: "test/injection-corpus.test.ts", test: "has at least eight cases, one per hiding place" },
  },
  {
    component: "The mod",
    attacker: "injected content",
    threat: "An instruction from untrusted content reaches native memory while only the mod sees the call",
    outcome: "prevented",
    mechanism: "The mod's `tool.check` repeats the memory hold and denies when its state has not loaded",
    code: ["src/mod/memory-hold.ts", "src/mod/tighten-hooks.ts"],
    proof: {
      file: "test/mod-memory-hold.test.ts",
      test: "holds an instruction line written to native memory after an untrusted read",
    },
  },
  {
    component: "Guards",
    attacker: "over-privileged process",
    threat: "The read-only verifier agent writes a file through Bash",
    outcome: "prevented",
    mechanism:
      "Its Bash calls pass the effect classifier: anything that is not a read, or a redirect into a file, is denied",
    code: ["src/review/read-only-shell.ts", "src/guards/review/hook.ts"],
    proof: { file: "test/verifier-shell.test.ts", test: "denies the verifier writing a file through Bash" },
  },
];

export const claims: readonly Threat[] = [
  {
    component: "Claims",
    attacker: "injected content",
    threat: "A claim from an external origin enters the context",
    outcome: "prevented",
    mechanism: "Instruction-shaped claims from external origins are refused and external facts stay in quarantine",
    code: ["src/knowledge/quarantine.ts"],
    proof: {
      file: "test/memory-injection.test.ts",
      test: "refuses an instruction-shaped claim from an external origin and keeps external facts out of the context",
    },
  },
  {
    component: "Claims",
    attacker: "mistaken agent",
    threat: "A claim about code that changed is still believed",
    outcome: "prevented",
    mechanism: "A claim whose anchored code changed is stale and not injected",
    code: ["src/knowledge/anchor.ts"],
    proof: { file: "test/knowledge-claims.test.ts", test: "never injects a stale claim into the context" },
  },
  {
    component: "Claims",
    attacker: "mistaken agent",
    threat: "The agent writes that the work is done after a failed gate",
    outcome: "prevented",
    mechanism: "The completion claim is blocked, quoting the claim and the failing check",
    code: ["src/claims/guard.ts"],
    proof: {
      file: "test/claims.test.ts",
      test: "blocks a completion claim when the last gate run failed, quoting the claim and the failing check",
    },
  },
  {
    component: "Claims",
    attacker: "wrong tool output",
    threat: "A checked claim stops being true",
    outcome: "detected",
    mechanism: "The claim's check runs at the gate when an anchored file changed and fails with the claim text",
    code: ["src/gate/checks/claims.ts"],
    proof: {
      file: "test/knowledge-claim-checks.test.ts",
      test: "renews a passing check at the current tree and fails the gate with the claim text when it breaks",
    },
  },
];

export const unattended: readonly Threat[] = [
  {
    component: "Unattended runs",
    attacker: "over-privileged process",
    threat: "A destructive or production action during a run nobody watches",
    outcome: "prevented",
    mechanism: "While a run is on, destructive and production actions are held and listed in the report",
    code: ["src/autonomy/hold.ts"],
    proof: {
      file: "test/autonomy.test.ts",
      test: "holds destructive and production actions while a run is on, and lists them in the report",
    },
  },
  {
    component: "Unattended runs",
    attacker: "looping agent",
    threat: "A contract larger than the agent can finish alone",
    outcome: "prevented",
    mechanism: "A contract above the local horizon is split or refused",
    code: ["src/autonomy/plan.ts"],
    proof: {
      file: "test/autonomy.test.ts",
      test: "refuses a contract larger than the local horizon that cannot be split finer, and splits one that can",
    },
  },
  {
    component: "Unattended runs",
    attacker: "bypassing agent",
    threat: "A fixed criterion is edited during the run",
    outcome: "detected",
    mechanism: "The part that depended on it is invalidated",
    code: ["src/autonomy/chain.ts"],
    proof: { file: "test/autonomy.test.ts", test: "an edit to a fixed criterion during the run invalidates the part" },
  },
  {
    component: "Unattended runs",
    attacker: "looping agent",
    threat: "Every stop is blocked again and the session never ends",
    outcome: "prevented",
    mechanism: "Blocking ends before Claude Code's own continuation cap with a visible NOT DONE",
    code: ["src/gate/hooks/counter.ts"],
    proof: { file: "test/stop.test.ts", test: "stops blocking before Claude Code's own continuation cap" },
  },
];
