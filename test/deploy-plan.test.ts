import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import { lintMigration } from "../src/deploy/migrations.js";
import { PLAN_PARTS } from "../src/deploy/plan.js";
import { migrationsCheck } from "../src/gate/checks/migrations.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { catalogs } from "../src/i18n/catalogs.js";
import { LANGUAGES } from "../src/i18n/languages.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const IGNORE = ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/infra.yml\n";
const SSH_SCRIPT = "#!/bin/sh\nssh deploy@shop.example.com 'docker compose pull && docker compose up -d'\n";

const project = (files: Readonly<Record<string, string>>): Repo => {
  const repo = makeRepo({ ".gitignore": IGNORE, ".finitemonkey/config.yml": "lang: en\n", ...files });
  repos.push(repo);
  return repo;
};

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

describe("migration lint", () => {
  it("flags DROP COLUMN and NOT NULL without default, with the line", () => {
    const sql = [
      "-- DROP COLUMN in a comment is ignored",
      "ALTER TABLE users ADD COLUMN email text NOT NULL;",
      "ALTER TABLE users ADD COLUMN plan text NOT NULL DEFAULT 'free';",
      "ALTER TABLE users ADD CONSTRAINT c CHECK (plan IS NOT NULL);",
      "ALTER TABLE users",
      "  DROP COLUMN legacy;",
      "ALTER TABLE users ALTER COLUMN name SET NOT NULL;",
    ].join("\n");
    assert.deepEqual(
      lintMigration("m.sql", sql).map((issue) => `${issue.kind}:${String(issue.line)}`),
      ["not-null-without-default:2", "drop-column:6", "not-null-without-default:7"],
    );
  });
});

describe("deploy plan", () => {
  it("never suggests Kubernetes below level 3, in any language", () => {
    for (const lang of LANGUAGES) {
      for (const level of ["level0", "level1", "level2"] as const) {
        for (const part of PLAN_PARTS.filter((name) => name !== "avoid")) {
          assert.doesNotMatch(catalogs[lang][`deploy.plan.${level}.${part}`], /kubernetes|kubectl|helm/i);
        }
        assert.match(catalogs[lang][`deploy.plan.${level}.avoid`], /Kubernetes/);
      }
    }
  });

  it("proposes the one-server plan with the check behind each item", async () => {
    const repo = project({ "scripts/deploy.sh": SSH_SCRIPT });
    repo.write("prisma/migrations/002_drop/migration.sql", "ALTER TABLE a DROP COLUMN b;\n");
    const run = await cliJson(["deploy", "plan"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 0, run.stdout);
    assert.equal(field(run.body, "data", "level"), 1);
    const items = field(run.body, "data", "items");
    assert.ok(Array.isArray(items));
    assert.deepEqual(
      items.map((item) => field(item, "check")),
      ["deploy", "pr", "migrations", "runtime", "rollback_evidence"],
    );
    const migrations = field(run.body, "data", "migrations");
    assert.ok(Array.isArray(migrations) && migrations.length === 1);
    const text = (await cli(["deploy", "plan"], { cwd: repo.root, runtime: repoRuntime() })).stdout;
    assert.match(text, /one container image built in CI/);
    assert.match(text, /002_drop\/migration\.sql:1: DROP COLUMN/);
  });

  it("asks once for the level, only a person confirms it, and the answer sticks", async () => {
    const repo = project({ "scripts/deploy.sh": SSH_SCRIPT });
    const first = await cliJson(["deploy", "plan"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(first.body["next"], "finitemonkey deploy plan --level 1 --yes");
    const agent = await cli(["deploy", "plan", "--level", "1", "--yes"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      env: { CLAUDECODE: "1" },
      stdin: tty(),
    });
    assert.equal(agent.code, 4);
    const person = await cli(["deploy", "plan", "--level", "1", "--yes"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      stdin: tty(),
    });
    assert.equal(person.code, 0, person.stdout);
    assert.match(repo.read(".finitemonkey/infra.yml"), /^level_source: confirmed$/m);
    const again = await cliJson(["deploy", "plan"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(again.body["next"], undefined);
    assert.equal(field(again.body, "data", "levelSource"), "confirmed");
    await cli(["infra", "--yes"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(repo.read(".finitemonkey/infra.yml"), /^level_source: confirmed$/m);
  });

  it("refuses a level above the detected one without an accepted decision", async () => {
    const repo = project({ "scripts/deploy.sh": SSH_SCRIPT });
    const run = await cliJson(["deploy", "plan", "--level", "3", "--yes"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      stdin: tty(),
    });
    assert.equal(field(run.body, "error", "code"), "deploy_level_needs_decision");
  });

  it("init does not ask for the deploy level", async () => {
    const repo = project({ "scripts/deploy.sh": SSH_SCRIPT });
    const run = await cliJson(["init", "--dry-run"], { cwd: repo.root, runtime: repoRuntime() });
    assert.doesNotMatch(run.stdout, /deploy plan|level/i);
  });
});

const startTask = (repo: Repo): void => {
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "drop the legacy column",
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
};

const gateContext = (repo: Repo): GateContext => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  return ready.prepared.ctx;
};

describe("migrations gate check", () => {
  it("fails on a contractive migration in the deploy and passes on an expansive one", () => {
    const repo = project({ "scripts/deploy.sh": SSH_SCRIPT });
    repo.write("migrations/003_add.sql", "ALTER TABLE a ADD COLUMN c int NULL;\n");
    startTask(repo);
    const check = { id: "migrations", kind: "migrations" as const };
    assert.equal(migrationsCheck(check, gateContext(repo)).status, "passed");
    repo.write("migrations/004_drop.sql", "ALTER TABLE a DROP COLUMN b;\n");
    const outcome = migrationsCheck(check, gateContext(repo));
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.notes[0]?.key, "gate.migrations.drop-column");
  });
});
