import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { breakingChanges, type ContractSide } from "../src/apicontract/breaking.js";
import { consistencyProblems } from "../src/apicontract/consistency.js";
import { parseRegistry } from "../src/apicontract/registry.js";
import { parseShape } from "../src/apicontract/shape.js";
import { contractCheck } from "../src/gate/checks/contract.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const side = (source: string): ContractSide => {
  const registry = parseRegistry(source);
  if (!registry.ok) throw new Error(registry.error.join("; "));
  return { registry: registry.value, shape: parseShape(source) };
};

const contract = (endpoints: string, head = ""): string => `${head}errors:\n  - NOT_FOUND\nendpoints:\n${endpoints}`;

const ORDER = `  - id: getOrder
    method: GET
    path: /orders/:id
    summary: one order
    domain: orders
    output:
      id: string
      total: number
`;

const kinds = (items: readonly { readonly kind: string }[]): readonly string[] => items.map((item) => item.kind);

describe("api consistency", () => {
  it("reports two error shapes in one API", () => {
    const source = contract(`${ORDER}    error:
      code: string
      message: string
  - id: listOrders
    method: GET
    path: /orders
    summary: orders
    domain: orders
    list: true
    error:
      type: string
      title: string
      status: number
`);
    const { registry, shape } = side(source);
    const problems = consistencyProblems(registry, shape);
    assert.deepEqual(kinds(problems), ["error_shapes"]);
    assert.match(JSON.stringify(problems), /getOrder/);
    assert.match(JSON.stringify(problems), /listOrders/);
  });

  it("checks against the declared error shape, pagination and naming", () => {
    const source = contract(
      `${ORDER}    error:
      code: string
  - id: listOrders
    method: GET
    path: /orders
    summary: orders
    domain: orders
    list: true
    input:
      page_token: string
      order_status: string?
    status:
      - 404
`,
      "error_shape:\n  type: string\n  title: string\npagination: offset\nnaming: camel\n",
    );
    const { registry, shape } = side(source);
    assert.deepEqual(kinds(consistencyProblems(registry, shape)), [
      "error_shape_mismatch",
      "pagination_mismatch",
      "page_token_required",
      "naming_mismatch",
      "naming_mismatch",
      "status_no_success",
    ]);
  });

  it("stays quiet on one error shape and one pagination scheme", () => {
    const source = contract(`${ORDER}    error:
      type: string
      title: string
  - id: listOrders
    method: GET
    path: /orders
    summary: orders
    domain: orders
    list: true
    input:
      page_size: number?
      page_token: string?
    error:
      title: string
      type: string
`);
    const { registry, shape } = side(source);
    assert.deepEqual(consistencyProblems(registry, shape), []);
  });
});

describe("api breaking changes", () => {
  it("removing a response field breaks; adding an optional one does not", () => {
    const base = side(contract(ORDER));
    const removed = side(contract(ORDER.replace("      total: number\n", "")));
    const added = side(contract(`${ORDER}      note: string?\n`));
    assert.deepEqual(breakingChanges(base, removed), [{ kind: "output_removed", id: "getOrder", field: "total" }]);
    assert.deepEqual(breakingChanges(base, added), []);
  });

  it("flags a new required input, a narrowed type and a removed status, and skips internal endpoints", () => {
    const base = side(contract(`${ORDER}    status:\n      - 200\n      - 404\n`));
    const head = side(
      contract(
        `${ORDER.replace("total: number", "total: string")}    input:\n      region: string\n    status:\n      - 200\n`,
      ),
    );
    assert.deepEqual(kinds(breakingChanges(base, head)), ["output_narrowed", "input_required", "status_removed"]);
    const internal = side(contract(`${ORDER}    stability: internal\n`));
    assert.deepEqual(breakingChanges(internal, side(contract(ORDER.replace("      total: number\n", "")))), []);
  });
});

const repoWith = (files: Readonly<Record<string, string>>): Repo => {
  const repo = makeRepo(files);
  cleanups.push(repo.cleanup);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "api",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [],
    tests: undefined,
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  return repo;
};

const context = (repo: Repo): GateContext => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(ready.kind);
  return ready.prepared.ctx;
};

const CHECK = { id: "contract", kind: "contract" as const };
const OWNERSHIP = "components:\n  - name: orders\n    owner: team-a\n    consumers:\n      - checkout-web\n";
const ACTIVE = "guards:\n  api-breaking: active\n  contract: off\n";

describe("gate contract check, breaking against the base", () => {
  const removedField = (extra: Readonly<Record<string, string>> = {}): Repo => {
    const repo = repoWith({
      "api/contract.yml": contract(ORDER),
      ".finitemonkey/ownership.yml": OWNERSHIP,
      ".finitemonkey/policy.yml": ACTIVE,
    });
    repo.write("api/contract.yml", contract(ORDER.replace("      total: number\n", "")));
    for (const [path, text] of Object.entries(extra)) repo.write(path, text);
    return repo;
  };

  it("reports the removed field with its listed consumer", () => {
    const outcome = contractCheck(CHECK, context(removedField()));
    assert.equal(outcome.status, "failed");
    const keys = outcome.notes.map((item) => item.key);
    assert.ok(keys.includes("gate.contract.break.output_removed"));
    const consumers = outcome.notes.find((item) => item.key === "gate.contract.break.consumers");
    assert.equal(consumers?.params["consumers"], "checkout-web");
  });

  it("passes once the version is bumped", () => {
    const repo = removedField();
    repo.write("api/contract.yml", contract(ORDER.replace("      total: number\n", ""), "version: 2\n"));
    const outcome = contractCheck(CHECK, context(repo));
    assert.equal(outcome.status, "passed");
    assert.ok(outcome.notes.some((item) => item.key === "gate.contract.break.versioned"));
  });

  it("passes once a decision in docs/plan names the endpoint", () => {
    const repo = removedField({ "docs/plan/03-decision-drop-total.md": "# Drop total\n\ngetOrder loses total.\n" });
    const outcome = contractCheck(CHECK, context(repo));
    assert.equal(outcome.status, "passed");
    assert.ok(outcome.notes.some((item) => item.key === "gate.contract.break.decided"));
  });

  it("only reports in shadow, the default", () => {
    const repo = removedField();
    repo.write(".finitemonkey/policy.yml", "guards:\n  contract: off\n");
    const outcome = contractCheck(CHECK, context(repo));
    assert.equal(outcome.status, "passed");
    assert.ok(outcome.notes.some((item) => item.key === "gate.contract.break_shadow"));
  });
});
