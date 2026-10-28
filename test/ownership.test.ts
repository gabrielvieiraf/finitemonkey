import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { ciChecks } from "../src/githooks/ci.js";
import { parseOwnership } from "../src/ownership/file.js";
import { ownershipCheck } from "../src/ownership/gate.js";
import { checkPlan } from "../src/plan/check.js";
import { cli, cliJson, fakeRuntime, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const at = (path: string): string => toAbsolutePath(path, ROOT);

const MASTER = [
  "# Plan",
  "",
  "## Goal",
  "",
  "## Decisions",
  "",
  "## Responsibilities",
  "",
  "| Responsibility | Owner |",
  "|---|---|",
  "| payments | @acme/pay |",
  "| checkout | @acme/web |",
  "",
  "## Numbers",
  "",
  "## Risks",
  "",
  "## Open questions",
  "",
  "## Reports",
  "",
].join("\n");

const ownership = (...components: readonly string[]): string =>
  ["components:", ...components.map((component) => `  - ${component}`), ""].join("\n");

const component = (name: string, owner: string): string =>
  `name: ${name}\n    type: service\n    owner: ${owner === "" ? '""' : `"${owner}"`}\n    consumers: [web]`;

const runtimeWith = (files: Readonly<Record<string, string>>) =>
  fakeRuntime({ files: Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])) });

describe("ownership check", () => {
  it("fails a component without owner", async () => {
    const runtime = runtimeWith({ ".finitemonkey/ownership.yml": ownership(component("payments", "")) });
    const run = await cli(["ownership", "check"], { runtime, cwd: ROOT });
    assert.equal(run.code, 1);
    assert.match(run.stdout + run.stderr, /no_owner: payments/);
  });

  it("fails a name outside the master plan vocabulary", async () => {
    const runtime = runtimeWith({
      "docs/plan/MASTER.md": MASTER,
      ".finitemonkey/ownership.yml": ownership(component("payments", "@acme/pay"), component("billing", "@acme/pay")),
    });
    const run = await cli(["ownership", "check"], { runtime, cwd: ROOT });
    assert.equal(run.code, 1);
    assert.match(run.stdout + run.stderr, /unknown_name: billing/);
    assert.doesNotMatch(run.stdout + run.stderr, /unknown_name: payments/);
  });

  it("works without a master plan: the vocabulary check is skipped", async () => {
    const runtime = runtimeWith({ ".finitemonkey/ownership.yml": ownership(component("billing", "@acme/pay")) });
    const run = await cli(["ownership", "check"], { runtime, cwd: ROOT });
    assert.equal(run.code, 0, run.stdout);
  });

  it("reads catalog-info.yaml when there is no ownership file", () => {
    const runtime = runtimeWith({
      "catalog-info.yaml":
        "apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: payments\nspec:\n  type: service\n---\nkind: Component\nmetadata:\n  name: search\nspec:\n  type: service\n",
    });
    assert.deepEqual(ownershipCheck(runtime, ROOT).failures, [
      "no_owner: payments (service) in catalog-info.yaml",
      "no_owner: search (service) in catalog-info.yaml",
    ]);
  });

  it("follows the ownership flag in policy.yml and runs inside ci gate", () => {
    const bad = ownership(component("payments", ""));
    const shadow = runtimeWith({
      ".finitemonkey/ownership.yml": bad,
      ".finitemonkey/policy.yml": "guards:\n  ownership: shadow\n",
    });
    assert.deepEqual(ownershipCheck(shadow, ROOT).failures, []);
    const active = runtimeWith({ ".finitemonkey/ownership.yml": bad });
    const gate = ciChecks(active, { root: ROOT, gitDir: ROOT, prefix: "" }, "origin/main");
    assert.deepEqual(gate.find((check) => check.id === "ownership")?.failures, [
      "no_owner: payments (service) in .finitemonkey/ownership.yml",
    ]);
  });

  it("parses the components list and rejects a file without one", () => {
    const parsed = parseOwnership(ownership(component("payments", "@acme/pay")));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value[0], { name: "payments", type: "service", owner: "@acme/pay", consumers: ["web"] });
    assert.equal(parseOwnership("name: x\n").ok, false);
  });
});

describe("plan check reads the ownership file", () => {
  it("reports a responsibility with no component and a component owned by someone else", () => {
    const runtime = runtimeWith({
      "docs/plan/MASTER.md": MASTER,
      ".finitemonkey/ownership.yml": ownership(component("payments", "@acme/other")),
    });
    const kinds = checkPlan(runtime, ROOT).issues.map((issue) => `${issue.kind}: ${issue.detail}`);
    assert.ok(kinds.includes("ownership_gap: checkout"), kinds.join("\n"));
    assert.ok(kinds.includes("ownership_overlap: payments: @acme/pay, @acme/other"), kinds.join("\n"));
  });
});

describe("gen ownership", () => {
  it("seeds the components and owners from the master plan", async () => {
    const runtime = runtimeWith({ "docs/plan/MASTER.md": MASTER });
    const run = await cliJson(["gen", "ownership", "--yes"], { runtime, cwd: ROOT });
    assert.deepEqual(field(run.body, "data", "written"), [".finitemonkey/ownership.yml"]);
    assert.deepEqual(ownershipCheck(runtime, ROOT).failures, []);
  });

  it("reuses catalog-info.yaml instead of writing a second file", async () => {
    const runtime = runtimeWith({ "catalog-info.yaml": "metadata:\n  name: payments\n" });
    const run = await cliJson(["gen", "ownership", "--yes"], { runtime, cwd: ROOT });
    assert.deepEqual(field(run.body, "data", "written"), []);
    assert.equal(runtime.readText(toAbsolutePath(at(".finitemonkey/ownership.yml"))).ok, false);
  });
});
