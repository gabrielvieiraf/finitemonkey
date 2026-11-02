import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { ExecRequest } from "../src/core/runtime.js";
import { infraPlanCheck } from "../src/gate/checks/infra-plan.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { composeFindings, composeVolumes } from "../src/infra/compose.js";
import { chartRoots } from "../src/infra/helm.js";
import { manifestChanges } from "../src/infra/manifests.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { execMissing, execResult } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const IGNORE = ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/policy.yml\n";

const statefulSet = (storageClass: string): string =>
  [
    "apiVersion: apps/v1",
    "kind: StatefulSet",
    "metadata:",
    "  name: db-postgres",
    "spec:",
    "  serviceName: db-postgres",
    "  replicas: 1",
    "  selector:",
    "    matchLabels:",
    "      app: db",
    "  volumeClaimTemplates:",
    "    - metadata:",
    "        name: data",
    "      spec:",
    `        storageClassName: ${storageClass}`,
    "        resources:",
    "          requests:",
    "            storage: 10Gi",
    "",
  ].join("\n");

const COMPOSE = [
  "services:",
  "  db:",
  "    image: postgres:16",
  "    volumes:",
  "      - pgdata:/var/lib/postgresql/data",
  "volumes:",
  "  pgdata:",
  "    driver: local",
  "  cache: {}",
  "  shared:",
  "    external: true",
  "",
].join("\n");

const fakeHelm = (request: ExecRequest) => {
  const chart = request.args[2] ?? ".";
  const templates = join(request.cwd, chart, "templates");
  if (!existsSync(templates)) return execResult(1, "", `Error: ${chart} has no templates`);
  const text = readdirSync(templates)
    .sort()
    .map((file) => `---\n# Source: ${file}\n${readFileSync(join(templates, file), "utf8")}`)
    .join("\n");
  return execResult(0, text);
};

const project = (files: Readonly<Record<string, string>>, active = true): Repo => {
  const repo = makeRepo({ ".gitignore": IGNORE, ".finitemonkey/config.yml": "lang: en\n", ...files });
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
  return repo;
};

const check = (repo: Repo, options: { helm?: boolean; criterion?: string; seen?: string[][] } = {}) => {
  const base = repoRuntime();
  const runtime = {
    ...base,
    exec: (request: ExecRequest) => {
      if (request.command !== "helm") return base.exec(request);
      options.seen?.push([...request.args]);
      return options.helm === false ? execMissing : fakeHelm(request);
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
  assert.ok(ctx.contract.acceptance.some((item) => item.kind === "infra-plan"));
  const extra =
    options.criterion === undefined ? [] : [{ id: "db", kind: "manual" as const, description: options.criterion }];
  const contract = { ...ctx.contract, acceptance: [...ctx.contract.acceptance, ...extra] };
  return infraPlanCheck({ id: "infra-plan", kind: "infra-plan" }, { ...ctx, contract });
};

const keys = (outcome: ReturnType<typeof infraPlanCheck>): readonly string[] => outcome.notes.map((item) => item.key);

const CHART = {
  "charts/db/Chart.yaml": "apiVersion: v2\nname: db\nversion: 0.1.0\n",
  "charts/db/values.yaml": "storageClass: standard\n",
  "charts/db/templates/statefulset.yaml": statefulSet("standard"),
};

describe("rendered manifests and compose files", () => {
  it("a stateful set whose volume claim template changes is a replacement; replicas alone are not", () => {
    assert.deepEqual(
      manifestChanges(statefulSet("standard"), statefulSet("fast")).map((finding) => finding.subject),
      ["StatefulSet/db-postgres (replace)"],
    );
    assert.deepEqual(
      manifestChanges(statefulSet("standard"), statefulSet("standard").replace("replicas: 1", "replicas: 3")),
      [],
    );
  });

  it("reads named volumes with their drivers and leaves external ones out of destroys", () => {
    assert.deepEqual(composeVolumes(COMPOSE), [
      { name: "pgdata", driver: "local", external: false },
      { name: "cache", driver: "local", external: false },
      { name: "shared", driver: "local", external: true },
    ]);
    const without = COMPOSE.replace("  shared:\n    external: true\n", "").replace(
      "  pgdata:\n    driver: local\n",
      "",
    );
    assert.deepEqual(
      composeFindings(COMPOSE, without).map((finding) => finding.subject),
      ["volume/pgdata (delete)"],
    );
    assert.deepEqual(
      composeFindings(COMPOSE, COMPOSE.replace("driver: local", "driver: rexray/ebs")).map(
        (finding) => finding.subject,
      ),
      ["volume/pgdata (replace)"],
    );
  });

  it("finds the chart root of a changed template", () => {
    assert.deepEqual(
      chartRoots(["charts/db/templates/statefulset.yaml", "src/app.ts"], (dir) => dir === "charts/db"),
      ["charts/db"],
    );
  });
});

describe("infra-plan gate check on charts and compose", () => {
  it("holds a chart change that replaces a database stateful set without a criterion, and passes with one", () => {
    const repo = project(CHART);
    repo.write("charts/db/templates/statefulset.yaml", statefulSet("fast"));
    const seen: string[][] = [];
    const held = check(repo, { seen });
    assert.equal(held.status, "failed");
    assert.ok(keys(held).includes("gate.infra_plan.stateful-destroy"));
    assert.ok(held.notes.some((item) => item.params["subject"] === "StatefulSet/db-postgres (replace)"));
    assert.ok(seen.every((args) => args[0] === "template"));
    assert.equal(seen.length, 2);
    assert.equal(check(repo, { criterion: "replace StatefulSet/db-postgres after a backup" }).status, "passed");
  });

  it("a chart change that keeps the stateful set passes", () => {
    const repo = project(CHART);
    repo.write("charts/db/templates/statefulset.yaml", statefulSet("standard").replace("replicas: 1", "replicas: 2"));
    assert.equal(check(repo).status, "passed");
  });

  it("without helm the chart is not verified, never passed", () => {
    const repo = project(CHART);
    repo.write("charts/db/templates/statefulset.yaml", statefulSet("fast"));
    const outcome = check(repo, { helm: false });
    assert.equal(outcome.status, "unverified");
    assert.ok(keys(outcome).includes("gate.infra_plan.not_verified"));
  });

  it("holds a Compose file that drops a named volume", () => {
    const repo = project({ "docker-compose.yml": COMPOSE });
    repo.write("docker-compose.yml", COMPOSE.replace("  pgdata:\n    driver: local\n", ""));
    const held = check(repo);
    assert.equal(held.status, "failed");
    assert.ok(held.notes.some((item) => item.params["subject"] === "volume/pgdata (delete)"));
  });

  it("in shadow the held result does not block", () => {
    const repo = project({ "docker-compose.yml": COMPOSE }, false);
    repo.write("docker-compose.yml", COMPOSE.replace("  pgdata:\n    driver: local\n", ""));
    const quiet = check(repo);
    assert.equal(quiet.status, "passed");
    assert.ok(keys(quiet).includes("gate.infra_plan.shadow"));
  });
});
