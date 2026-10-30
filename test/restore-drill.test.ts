import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { parseJsonObject } from "../src/core/parsed.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { parseCounts, reachFindings, restoreConfig } from "../src/db/restore.js";
import { parseConfigYaml } from "../src/git/project-config.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const STORE = (lines: readonly string[]): string =>
  ["lang: en", "restore:", '  app_account: "111"', "  app_buckets: [acme-app]", "  stores:", "    db:", ...lines].join(
    "\n",
  );

const project = (config: string, files: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({
    ".gitignore": ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/policy.yml\n",
    ".finitemonkey/config.yml": config,
    ...files,
  });
  repos.push(repo);
  return repo;
};

const recording = (seen: ExecRequest[]) => {
  const base = repoRuntime();
  return {
    ...base,
    exec: (request: ExecRequest) => {
      seen.push(request);
      return base.exec(request);
    },
  };
};

describe("backup reach", () => {
  it("a backup in the same bucket and account as the app credential is reported", () => {
    const config = restoreConfig(
      parseConfigYaml(STORE(['      backup: "s3://acme-app/backups/db"', '      backup_account: "111"'])),
    );
    assert.deepEqual(
      reachFindings(repoRuntime(), makeRepoRoot(), config).map((item) => item.problem),
      ["same-bucket"],
    );
    const elsewhere = restoreConfig(
      parseConfigYaml(STORE(['      backup: "s3://acme-vault/db"', '      backup_account: "222"'])),
    );
    assert.deepEqual(reachFindings(repoRuntime(), makeRepoRoot(), elsewhere), []);
    const locked = restoreConfig(
      parseConfigYaml(STORE(['      backup: "s3://acme-vault/db"', "      protection: object-lock"])),
    );
    assert.deepEqual(reachFindings(repoRuntime(), makeRepoRoot(), locked), []);
  });

  it("reads row counts as JSON or as name and number lines", () => {
    assert.deepEqual(parseCounts('{"users": 3, "orders": 0}'), { users: 3, orders: 0 });
    assert.deepEqual(parseCounts("users 3\norders: 5\n"), { users: 3, orders: 5 });
  });
});

const firstOf = (body: unknown, list: string, key: string): unknown => {
  const items = field(body, "data", list);
  return Array.isArray(items) ? field(items[0], key) : undefined;
};

const makeRepoRoot = () => project("lang: en\n").root;

describe("restore drill", () => {
  it("a restore that does not come up fails the drill", async () => {
    const repo = project(
      STORE([
        '      backup: "s3://acme-vault/db"',
        '      restore: "node -e process.exit(3)"',
        '      target: "postgres://localhost:5439/drill"',
      ]),
    );
    const run = await cliJson(["restore", "drill"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 1);
    assert.equal(firstOf(run.body, "drills", "status"), "failed");
  });

  it("a successful drill writes date, source and counts to the ledger", async () => {
    const repo = project(
      STORE([
        '      backup: "s3://acme-vault/db"',
        '      restore: "node -e 0"',
        '      target: "postgres://localhost:5439/drill"',
        `      counts: 'node -e "console.log(JSON.stringify({users: 4}))"'`,
        "      expect: [users]",
      ]),
    );
    const run = await cliJson(["restore", "drill"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 0, run.stdout);
    const log = repo.read(join(".finitemonkey", "log.jsonl"));
    const line = log.split("\n").find((item) => item.includes("restore_drill")) ?? "";
    const parsed = parseJsonObject(line);
    assert.ok(parsed.ok);
    assert.equal(parsed.value["status"], "passed");
    assert.equal(parsed.value["source"], "s3://acme-vault/db");
    assert.deepEqual(parsed.value["counts"], { users: 4 });
    assert.equal(typeof parsed.value["at"], "string");
    const check = await cliJson(["restore", "check"], { cwd: repo.root, runtime: repoRuntime() });
    assert.deepEqual(field(check.body, "data", "stale"), []);
  });

  it("never writes to a target that is not a local throwaway", async () => {
    const repo = project(
      STORE([
        '      backup: "s3://acme-vault/db"',
        '      restore: "node -e 0"',
        '      target: "postgres://admin@db.prod.example.com/app"',
      ]),
    );
    const seen: ExecRequest[] = [];
    const run = await cliJson(["restore", "drill"], { cwd: repo.root, runtime: recording(seen) });
    assert.equal(firstOf(run.body, "drills", "status"), "refused");
    assert.deepEqual(
      seen.filter((request) => request.command.includes("node -e")),
      [],
    );
  });

  it("restore check reports reach in shadow without failing, and fails when active", async () => {
    const repo = project(STORE(['      backup: "s3://acme-app/backups/db"']));
    const shadow = await cliJson(["restore", "check"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(shadow.code, 0);
    assert.equal(firstOf(shadow.body, "reach", "problem"), "same-bucket");
    repo.write(".finitemonkey/policy.yml", "guards:\n  restore-drill: active\n");
    const active = await cliJson(["restore", "check"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(active.code, 1);
  });
});
