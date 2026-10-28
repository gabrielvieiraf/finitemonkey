import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import { check as prettierCheck } from "prettier";

import { auditWorkflow } from "../src/ci/audit/rules.js";
import { parseWorkflow } from "../src/ci/audit/workflow.js";
import type { TextSource } from "../src/core/context.js";
import { composeFile, deployWorkflow, driftWorkflow, remoteScript } from "../src/deploy/templates.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
const dirs: string[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const INPUT = {
  branch: "main",
  checks: ["npm run lint", "npm run test"],
  node: true,
  install: "npm ci",
  port: 3000,
  health: "/health",
};

const auditRules = (file: string, text: string): readonly string[] => {
  const parsed = parseWorkflow(file, text);
  assert.ok(parsed.ok, file);
  return auditWorkflow(parsed.value, { level: 3, publicRepo: true }).map((hit) => `${hit.rule}: ${hit.detail}`);
};

describe("deploy generate templates", () => {
  it("the workflow passes ci audit at the strictest level and prettier parses it unchanged", async () => {
    const workflow = deployWorkflow(INPUT);
    assert.deepEqual(auditRules("deploy.yml", workflow), []);
    assert.ok(await prettierCheck(workflow, { parser: "yaml" }), workflow);
    assert.ok(await prettierCheck(composeFile(3000), { parser: "yaml" }));
    assert.match(workflow, /StrictHostKeyChecking=yes/);
    assert.match(workflow, /needs: check/);
  });

  it("the scheduled drift workflow passes ci audit too", async () => {
    const drift = driftWorkflow("main", "1.2.3");
    assert.deepEqual(auditRules("drift.yml", drift), []);
    assert.ok(await prettierCheck(drift, { parser: "yaml" }), drift);
    assert.match(drift, /deploy check --issue/);
    assert.match(drift, /issues: write/);
  });
});

const fakeBin = (dir: string, healthyImage: string): string => {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const docker = [
    "#!/bin/sh",
    'if [ "$1 $2" = "compose --env-file" ]; then . "./$3"; fi',
    'case "$*" in *" up "*) printf \'%s\\n\' "$IMAGE" > running ;; esac',
    "exit 0",
    "",
  ].join("\n");
  const curl = ["#!/bin/sh", `[ "$(cat running)" = "${healthyImage}" ]`, ""].join("\n");
  writeFileSync(join(bin, "docker"), docker);
  writeFileSync(join(bin, "curl"), curl);
  writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  for (const name of ["docker", "curl", "sleep"]) chmodSync(join(bin, name), 0o755);
  return bin;
};

const deployOnce = (dir: string, bin: string, image: string) =>
  spawnSync("sh", ["-s", "--", image, "http://127.0.0.1:3000/health"], {
    input: remoteScript(),
    env: { PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`, DEPLOY_DIR: dir, HEALTH_TRIES: "2" },
    encoding: "utf8",
  });

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

describe("deploy generate rollback", { skip: process.platform === "win32" ? "POSIX sh only" : false }, () => {
  it("rolls back to the previous digest when the new one is unhealthy, and records the evidence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-server-"));
    dirs.push(dir);
    const good = "ghcr.io/acme/shop@sha256:aaa";
    const bad = "ghcr.io/acme/shop@sha256:bbb";
    const bin = fakeBin(dir, good);
    assert.equal(deployOnce(dir, bin, good).status, 0);
    assert.equal(readFileSync(join(dir, "digest"), "utf8").trim(), good);
    const failed = deployOnce(dir, bin, bad);
    assert.equal(failed.status, 1, failed.stderr);
    assert.equal(readFileSync(join(dir, "digest"), "utf8").trim(), good);
    assert.equal(readFileSync(join(dir, "running"), "utf8").trim(), good);
    const log = readFileSync(join(dir, "deploy.log"), "utf8");
    assert.match(log, /unhealthy ghcr\.io\/acme\/shop@sha256:bbb/);
    const line = log.split("\n").find((entry) => entry.includes("rolled back to"));
    if (line === undefined) throw new Error(`no rollback line in ${log}`);
    assert.ok(line.endsWith(good));

    const repo = makeRepo({
      Dockerfile: "FROM node:22\nUSER node\n",
      "scripts/deploy.sh": "ssh deploy@h.example.com x\n",
    });
    repos.push(repo);
    const recorded = await cli(["deploy", "plan", "--rollback-evidence", line, "--yes"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      stdin: tty(),
    });
    assert.equal(recorded.code, 0, recorded.stdout);
    const plan = await cliJson(["deploy", "plan"], { cwd: repo.root, runtime: repoRuntime() });
    const items = field(plan.body, "data", "items");
    assert.ok(Array.isArray(items));
    assert.equal(
      field(
        items.find((item) => field(item, "id") === "rollback"),
        "ok",
      ),
      true,
    );
  });
});

const PACKAGE = '{ "scripts": { "lint": "eslint .", "test": "node --test" } }\n';

const project = (files: Readonly<Record<string, string>>): Repo => {
  const repo = makeRepo({
    "package.json": PACKAGE,
    "package-lock.json": "{}\n",
    Dockerfile: "FROM node:22\nUSER node\n",
    "scripts/deploy.sh": "#!/bin/sh\nssh deploy@shop.example.com 'git pull && npm run build'\n",
    ...files,
  });
  repos.push(repo);
  return repo;
};

describe("finitemonkey deploy generate", () => {
  it("shows the files first, creates them with --yes and never overwrites", async () => {
    const repo = project({ "deploy/compose.yml": "services: {}\n" });
    const preview = await cliJson(["deploy", "generate"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(preview.code, 0, preview.stdout);
    assert.equal(preview.body["next"], "finitemonkey deploy generate --yes");
    assert.throws(() => repo.read(".github/workflows/deploy.yml"));
    const done = await cli(["deploy", "generate", "--yes"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(done.code, 0, done.stdout);
    assert.match(done.stdout, /exists and differs, kept: deploy\/compose\.yml/);
    assert.equal(repo.read("deploy/compose.yml"), "services: {}\n");
    const workflow = repo.read(".github/workflows/deploy.yml");
    assert.deepEqual(auditRules("deploy.yml", workflow), []);
    assert.match(workflow, /run: npm ci/);
    assert.match(workflow, /run: npm run test/);
    assert.match(repo.read("deploy/remote.sh"), /rolled back to/);
    assert.deepEqual(auditRules("drift.yml", repo.read(".github/workflows/drift.yml")), []);
  });

  it("refuses projects that are not one server", async () => {
    const repo = project({ "k8s/web.yaml": "apiVersion: apps/v1\nkind: Deployment\n" });
    const run = await cliJson(["deploy", "generate", "--yes"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(run.body, "error", "code"), "deploy_generate_blocked");
  });
});
