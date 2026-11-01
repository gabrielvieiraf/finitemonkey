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

export const network: readonly Threat[] = [
  {
    component: "Network use",
    attacker: "compromised dependency",
    threat: "Code in `src/` opens a connection the footprint does not list",
    outcome: "prevented",
    mechanism:
      "`src/` opens no socket; every program that reaches the network is in the footprint with its host, and the README tables are generated from it",
    code: ["src/core/footprint.ts"],
    proof: { file: "test/docs-generated.test.ts", test: "src opens no socket of its own" },
  },
  {
    component: "Network use",
    attacker: "compromised dependency",
    threat: "A hook downloads code at run time",
    outcome: "prevented",
    mechanism: "Hooks run the bundled CLI with `node`, never `npx`",
    code: ["plugin/hooks/hooks.json"],
    proof: { file: "test/hook-latency.test.ts", test: "plugin hooks never call npx" },
  },
  {
    component: "Network use",
    attacker: "over-privileged process",
    threat: "The package registry lookup of the deps guard leaks package names",
    outcome: "reduced",
    mechanism: "Only the package name is sent, and `FINITEMONKEY_OFFLINE=1` turns the lookup off",
    code: ["src/deps/registry.ts"],
    proof: {
      file: "test/deps-guard.test.ts",
      test: "makes no request with FINITEMONKEY_OFFLINE and keeps the local spelling check",
    },
  },
  {
    component: "Network use",
    attacker: "over-privileged process",
    threat: "The infra plan check changes infrastructure",
    outcome: "prevented",
    mechanism:
      "The check runs `terraform plan` and `terraform show` only, which read the provider APIs with the credentials terraform finds; no code path runs apply",
    code: ["src/gate/checks/infra-plan.ts"],
    proof: { file: "test/infra-plan.test.ts", test: "runs plan and show only; no code path runs apply" },
  },
  {
    component: "Network use",
    attacker: "injected content",
    threat: "The app under a look run sends requests outside the machine",
    outcome: "prevented",
    mechanism:
      "The look run refuses an app host that is not loopback, and the browser context aborts and lists every request to a host that is not loopback",
    code: ["src/look/run.ts", "src/look/node-ux.ts"],
    proof: {
      file: "test/look-boot.test.ts",
      test: "only loopback hosts count as local for the app boot and the request filter",
    },
  },
  {
    component: "Network use",
    attacker: "over-privileged process",
    threat: "Checking the citations of a research note sends the note to the web",
    outcome: "reduced",
    mechanism:
      "Only the cited DOI or URL is requested, through `curl`; the note, its quotes and its claims stay on the machine, and local sources never read `.env` or key files",
    code: ["src/judge/fetch.ts"],
    proof: {
      file: "test/judge-cite.test.ts",
      test: "runs offline against a fake fetch and sends only the cited identifier",
    },
  },
  {
    component: "Network use",
    attacker: "over-privileged process",
    threat: "A proposal run on the person's own Claude Code sends project text to the model provider",
    outcome: "reduced",
    mechanism:
      "Off by default: only kinds the person turned on in a terminal run, each with a fixed prompt, a turn limit and only the tools it needs, and never from a synchronous hook; `provider enable` prints what the kind sends and its cost before the yes, and `providers.maxUsdPerDay` stops calls for the day",
    code: ["src/provider/call.ts", "src/commands/provider.ts"],
    proof: { file: "test/provider.test.ts", test: "with no kind enabled, no command or hook spawns claude" },
  },
  {
    component: "Network use",
    attacker: "bypassing agent",
    threat: "The agent turns a proposal kind on to get model output into the flow",
    outcome: "prevented",
    mechanism:
      "`provider enable` is person-only (a terminal on stdin and no `CLAUDECODE`), and the self guard blocks tool writes to `.finitemonkey/provider.json`",
    code: ["src/commands/provider.ts", "src/guards/self/protected.ts"],
    proof: { file: "test/provider.test.ts", test: "provider enable run by the agent is refused" },
  },
  {
    component: "Network use",
    attacker: "wrong tool output",
    threat: "The model returns malformed output, or calls everything supported or correct",
    outcome: "prevented",
    mechanism:
      "Output is validated against the interface type and dropped and logged when invalid; a proposal is stored with origin `model-proposed` and never sets a gate verdict, a band, a support state or an approved example",
    code: ["src/provider/validate.ts", "src/provider/call.ts"],
    proof: {
      file: "test/provider-kinds.test.ts",
      test: "a malformed or yes-saying model moves no support state, band or concept",
    },
  },
  {
    component: "Network use",
    attacker: "mistaken agent",
    threat: "A divergence or blind-test generator edits the person's working tree",
    outcome: "prevented",
    mechanism: "Both run in a throwaway worktree that Finite Monkey adds at the base commit and removes afterwards",
    code: ["src/provider/generators.ts"],
    proof: {
      file: "test/provider-worktree.test.ts",
      test: "divergence and blind-test calls leave the working tree byte-identical",
    },
  },
];
