import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { auditText } from "../src/ci/audit/audit.js";
import { drillCron } from "../src/ci/gen/restore-drill.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { compareSchema, parseSchema } from "../src/db/restore-schema.js";
import { checkRestoreDrill } from "../src/doctor/restore.js";
import type { DoctorEnv } from "../src/doctor/types.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, fakeRuntime, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const ROOT = toAbsolutePath("/home/ana/app");
const at = (path: string): string => toAbsolutePath(path, ROOT);

const STORE_LINES = [
  "lang: en",
  "restore:",
  "  period_days: 7",
  "  stores:",
  "    db:",
  '      backup: "s3://acme-vault/db"',
  '      restore: "node -e 0"',
  '      target: "postgres://localhost:5439/drill"',
];

const project = (config: string, files: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({
    ".gitignore": ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/policy.yml\n",
    ".finitemonkey/config.yml": config,
    ...files,
  });
  repos.push(repo);
  return repo;
};

const firstDrill = (body: unknown, key: string): unknown => {
  const drills = field(body, "data", "drills");
  return Array.isArray(drills) ? field(drills[0], key) : undefined;
};

const DUMP = `'node -e "console.log(JSON.stringify({users: [\\"id\\"], orders: [\\"id\\", \\"total\\"]}))"'`;

describe("restored schema against a declared expectation", () => {
  it("reads the expectation as JSON or as table.column lines", () => {
    assert.deepEqual([...parseSchema('{"users": ["id", "email"]}')], ["users.id", "users.email"]);
    assert.deepEqual([...parseSchema("users.id\nnot a column\norders.total\n")], ["users.id", "orders.total"]);
  });

  it("a missing expectation file fails instead of passing", () => {
    const repo = project("lang: en\n");
    assert.deepEqual(compareSchema(repoRuntime(), repo.root, "schema.json", "users.id"), {
      ok: false,
      reason: "expectation-missing",
      file: "schema.json",
    });
  });

  it("a restored schema missing a declared column fails the drill; a complete one passes", async () => {
    const config = [...STORE_LINES, `      schema_dump: ${DUMP}`, '      schema: "db/expected-schema.json"', ""].join(
      "\n",
    );
    const repo = project(config, {
      "db/expected-schema.json": JSON.stringify({ users: ["id", "email"], orders: ["id"] }),
    });
    const failedRun = await cliJson(["restore", "drill"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(failedRun.code, 1);
    assert.equal(firstDrill(failedRun.body, "status"), "failed");
    assert.match(String(firstDrill(failedRun.body, "detail")), /missing columns: users\.email/);
    repo.write("db/expected-schema.json", JSON.stringify({ users: ["id"], orders: ["id", "total"] }));
    const passedRun = await cliJson(["restore", "drill"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(passedRun.code, 0, passedRun.stdout);
    assert.equal(firstDrill(passedRun.body, "status"), "passed");
  });
});

describe("scheduled restore drill", () => {
  it("ci gen --with restore-drill writes a scheduled workflow that passes ci audit", async () => {
    const config = [...STORE_LINES, ""].join("\n");
    const runtime = fakeRuntime({
      files: {
        [at("package.json")]: JSON.stringify({ name: "app", scripts: { test: "vitest run" } }),
        [at("package-lock.json")]: "{}\n",
        [at(".finitemonkey/config.yml")]: config,
      },
    });
    const run = await cliJson(["ci", "gen", "--yes", "--with", "restore-drill"], { runtime, cwd: ROOT });
    assert.equal(run.code, 0, run.stdout);
    const read = runtime.readText(toAbsolutePath(at(".github/workflows/restore-drill.yml")));
    assert.ok(read.ok);
    assert.match(read.value, /schedule:\n {4}- cron: "17 5 \* \* 1"/);
    assert.match(read.value, /workflow_dispatch:/);
    assert.match(read.value, /environment: restore-drill/);
    assert.match(read.value, /restore drill$/m);
    for (const level of [1, 2, 3] as const) {
      assert.deepEqual(
        auditText(".github/workflows/restore-drill.yml", read.value, level, true),
        [],
        `level ${String(level)}`,
      );
    }
    assert.equal(drillCron(30), "17 5 1 * *");
  });

  const doctorEnv = (files: Readonly<Record<string, string>>, now: string): DoctorEnv => ({
    platform: "linux",
    env: {},
    cwd: ROOT,
    root: ROOT,
    version: "9.9.9-test",
    runtime: fakeRuntime({
      now,
      files: Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
    }),
  });

  it("doctor reminds when the drill period passed, only when restore-drill is active", () => {
    const config = [...STORE_LINES, ""].join("\n");
    const log = `${JSON.stringify({ event: "restore_drill", store: "db", status: "passed", at: "2026-10-01T00:00:00.000Z" })}\n`;
    const files = { ".finitemonkey/config.yml": config, ".finitemonkey/log.jsonl": log };
    const active = { ...files, ".finitemonkey/policy.yml": "guards:\n  restore-drill: active\n" };
    assert.deepEqual(checkRestoreDrill(doctorEnv(files, "2026-11-01T00:00:00.000Z")), []);
    const overdue = checkRestoreDrill(doctorEnv(active, "2026-11-01T00:00:00.000Z"));
    assert.equal(overdue[0]?.status, "warn");
    assert.equal(overdue[0].messageKey, "doctor.restore.stale");
    assert.deepEqual(checkRestoreDrill(doctorEnv(active, "2026-10-03T00:00:00.000Z")), []);
  });
});
