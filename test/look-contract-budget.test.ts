import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { parseYaml } from "../src/core/yaml/parse.js";
import { stringifyYaml } from "../src/core/yaml/write.js";
import { parseUiContract } from "../src/look/contract.js";
import { capUiContract, sectionCount } from "../src/look/contract-budget.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const PROPOSAL = [
  "ui:",
  "  - screen: /orders",
  "    primary_action:",
  "      role: button",
  "      name: Create order",
  "    states: [ideal, empty, error]",
  "    mocks:",
  "      empty: no-orders",
  "    back: /",
  "    steps_max: 3",
  "    forms: [form.order]",
  "  - screen: /orders/new",
  "    states: [ideal, error]",
  "    back: /orders",
  "  - screen: /settings",
  "    back: /",
  "",
].join("\n");

const tree = () => {
  const parsed = parseYaml(PROPOSAL);
  if (!parsed.ok) throw new Error("bad yaml");
  return parsed.value;
};

describe("ui contract: size follows the task", () => {
  it("a small task gets a smaller proposed contract than a large one on the same app", () => {
    const small = capUiContract(tree(), "S");
    const medium = capUiContract(tree(), "M");
    const large = capUiContract(tree(), "L");
    assert.equal(sectionCount(large.tree), 9);
    assert.deepEqual(large.dropped, []);
    assert.ok(sectionCount(small.tree) < sectionCount(medium.tree));
    assert.ok(sectionCount(medium.tree) <= sectionCount(large.tree));
    assert.equal(sectionCount(small.tree), 2);
    assert.ok(small.dropped.includes("/settings: screen"));
    assert.ok(small.dropped.includes("/orders: forms"));
  });

  it("keeps the primary action and the states first", () => {
    const small = capUiContract(tree(), "S").tree;
    const parsed = parseUiContract(stringifyYaml(small));
    assert.ok(parsed.ok);
    assert.equal(parsed.value.length, 1);
    const [screen] = parsed.value;
    assert.ok(screen !== undefined);
    assert.equal(screen.primaryAction?.name, "Create order");
    assert.deepEqual(screen.states, ["ideal", "empty", "error"]);
    assert.equal(screen.back, undefined);
  });
});

const TASK = (size: string): string =>
  ["id: t1", "goal: screens", `size: ${size}`, "acceptance:", "  - id: look", "    check: look", ""].join("\n");

const propose = async (size: string, policy: string): Promise<{ readonly ui: string; readonly stdout: string }> => {
  const repo = makeRepo({
    ".finitemonkey/tasks/t1.yml": TASK(size),
    ".finitemonkey/policy.yml": policy,
    "proposal.yml": PROPOSAL,
  });
  repos.push(repo);
  const run = await cli(["ui", "propose", "t1", "--from", "proposal.yml"], { runtime: repoRuntime(), cwd: repo.root });
  assert.equal(run.code, 0, run.stdout + run.stderr);
  return { ui: repo.read(".finitemonkey/tasks/t1/ui.yml"), stdout: run.stdout };
};

const sections = (source: string): number => {
  const parsed = parseYaml(source);
  return parsed.ok ? sectionCount(parsed.value) : -1;
};

describe("ui propose with the proportionality budget", () => {
  it("with ui-contract active a size S task stores a smaller contract than a size L task", async () => {
    const small = await propose("S", "guards:\n  ui-contract: active\n");
    const large = await propose("L", "guards:\n  ui-contract: active\n");
    assert.ok(sections(small.ui) < sections(large.ui));
    assert.equal(large.ui, PROPOSAL);
    assert.ok(small.stdout.includes("A size S task gets a smaller UI contract"), small.stdout);
  });

  it("in shadow the proposal is kept whole and the trim is only logged", async () => {
    const small = await propose("S", "");
    assert.equal(small.ui, PROPOSAL);
    assert.ok(!small.stdout.includes("smaller UI contract"));
  });
});
