import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { ExecRequest } from "../src/core/runtime.js";
import { infraPlanCheck } from "../src/gate/checks/infra-plan.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { manifestResources, readPlan, removedStateful } from "../src/infra/plan-gate.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { execResult, ROOT } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const IGNORE = ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/policy.yml\nplan.json\n";

const change = (address: string, type: string, actions: readonly string[], after: object = {}) => ({
  address,
  type,
  change: { actions, after },
});

const REPLACE_DB = { resource_changes: [change("aws_db_instance.main", "aws_db_instance", ["delete", "create"])] };
const ADDITIVE = {
  resource_changes: [
    change("aws_instance.web", "aws_instance", ["update"], { tags: { team: "web" } }),
    change("aws_security_group.extra", "aws_security_group", ["create"]),
  ],
};
const WILDCARD = {
  resource_changes: [
    change("aws_iam_policy.admin", "aws_iam_policy", ["create"], {
      policy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] }),
    }),
  ],
};

const project = (config: string, active = true): Repo => {
  const repo = makeRepo({
    ".gitignore": IGNORE,
    ".finitemonkey/config.yml": config,
    "infra/main.tf": 'resource "aws_db_instance" "main" {}\n',
  });
  repos.push(repo);
  if (active) repo.write(".finitemonkey/policy.yml", "guards:\n  infra-plan: active\n");
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "change the database",
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
  repo.write("infra/main.tf", 'resource "aws_db_instance" "main" { engine = "postgres" }\n');
  return repo;
};

type Terraform = (args: readonly string[]) => ReturnType<typeof execResult>;

const check = (repo: Repo, options: { terraform?: Terraform; seen?: string[][]; criterion?: string } = {}) => {
  const base = repoRuntime();
  const runtime = {
    ...base,
    exec: (request: ExecRequest) => {
      if (request.command !== "terraform") return base.exec(request);
      options.seen?.push([...request.args]);
      return options.terraform === undefined ? { ...execResult(null), found: false } : options.terraform(request.args);
    },
  };
  const ready = prepareGate({
    runtime,
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  const ctx: GateContext = ready.prepared.ctx;
  assert.ok(
    ctx.contract.acceptance.some((item) => item.kind === "infra-plan"),
    "added when infrastructure changes",
  );
  const contract =
    options.criterion === undefined
      ? ctx.contract
      : {
          ...ctx.contract,
          acceptance: [
            ...ctx.contract.acceptance,
            { id: "db", kind: "manual" as const, description: options.criterion },
          ],
        };
  return infraPlanCheck({ id: "infra-plan", kind: "infra-plan" }, { ...ctx, contract });
};

const keys = (outcome: ReturnType<typeof infraPlanCheck>): readonly string[] => outcome.notes.map((item) => item.key);

const withPlan = (plan: object): Repo => {
  const repo = project("lang: en\ninfra_plan:\n  plan_json: plan.json\n");
  repo.write("plan.json", JSON.stringify(plan));
  return repo;
};

describe("infrastructure plan reading", () => {
  it("counts actions and flags stateful replacement, wildcard policy and secret outputs", () => {
    const summary = readPlan({
      ...REPLACE_DB,
      output_changes: { db_password: { after_sensitive: false }, url: { after_sensitive: false } },
    });
    assert.deepEqual(summary.counts, { create: 0, update: 0, delete: 0, replace: 1 });
    assert.deepEqual(
      summary.findings.map((finding) => finding.kind),
      ["stateful-destroy", "secret-output"],
    );
    assert.equal(readPlan(WILDCARD).findings[0]?.kind, "wildcard-policy");
    assert.deepEqual(readPlan(ADDITIVE).findings, []);
  });

  it("a stateful set removed from the manifests is a destroy", () => {
    const before = manifestResources(
      "kind: StatefulSet\nmetadata:\n  name: pg\n---\nkind: Service\nmetadata:\n  name: web\n",
    );
    assert.equal(removedStateful(before, [])[0]?.subject, "StatefulSet/pg (delete)");
    assert.deepEqual(removedStateful(before, before), []);
  });
});

describe("infra-plan gate check", () => {
  it("holds a database replacement without a contract criterion and passes with one", () => {
    const repo = withPlan(REPLACE_DB);
    const held = check(repo);
    assert.equal(held.status, "failed");
    assert.ok(keys(held).includes("gate.infra_plan.stateful-destroy"));
    const allowed = check(repo, { criterion: "replace aws_db_instance.main to change the engine" });
    assert.equal(allowed.status, "passed");
  });

  it("an additive change passes", () => {
    assert.equal(check(withPlan(ADDITIVE)).status, "passed");
  });

  it("a wildcard identity policy is reported", () => {
    assert.ok(keys(check(withPlan(WILDCARD))).includes("gate.infra_plan.wildcard-policy"));
  });

  it("a missing credential or a missing terraform is not verified, never a pass", () => {
    const repo = project("lang: en\n");
    const noCreds = check(repo, {
      terraform: () => execResult(1, "", "Error: No valid credential sources found"),
    });
    assert.equal(noCreds.status, "unverified");
    assert.equal(check(repo).status, "unverified");
    const shadow = project("lang: en\n", false);
    const quiet = check(shadow);
    assert.equal(quiet.status, "passed");
    assert.ok(keys(quiet).includes("gate.infra_plan.not_verified"));
  });

  it("runs plan and show only; no code path runs apply", () => {
    const repo = project("lang: en\n");
    const seen: string[][] = [];
    const outcome = check(repo, {
      seen,
      terraform: (args) => execResult(0, args.includes("show") ? JSON.stringify(ADDITIVE) : ""),
    });
    assert.equal(outcome.status, "passed");
    assert.deepEqual(
      seen.map((args) => args[1]),
      ["plan", "show"],
    );
    for (const file of ["src/gate/checks/infra-plan.ts", "src/infra/plan-gate.ts"]) {
      assert.doesNotMatch(readFileSync(join(ROOT, file), "utf8"), /["'](?:apply|destroy)["']/);
    }
  });
});
