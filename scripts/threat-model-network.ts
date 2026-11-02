import type { Threat } from "./threat-model.js";

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
