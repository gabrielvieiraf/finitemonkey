import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { ExecRequest, ExecResult, Runtime } from "../src/core/runtime.js";
import { deployCheck } from "../src/gate/checks/deploy.js";
import { prepareGate } from "../src/gate/prepare.js";
import { remoteCommand } from "../src/infra/ssh.js";
import { readOnlyScript } from "../src/prod/readonly.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, execResult, field } from "./support.js";

const repos: Repo[] = [];
const dirs: string[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const TITLE = "Production diverged from main";

interface Server {
  readonly remote: string[];
  readonly gh: (readonly string[])[];
  readonly runtime: Runtime;
}

const server = (docker: string, issues: () => string = () => "[]"): Server => {
  const remote: string[] = [];
  const gh: (readonly string[])[] = [];
  const base = repoRuntime();
  const answer = (request: ExecRequest): ExecResult => {
    if (request.command === "gh") {
      gh.push(request.args);
      return request.args[1] === "list"
        ? execResult(0, issues())
        : execResult(0, "https://github.com/acme/shop/issues/7");
    }
    const command = request.args.at(-1) ?? "";
    remote.push(command);
    if (command.startsWith("docker ")) return execResult(0, docker);
    const run = spawnSync("sh", ["-c", command], { encoding: "utf8" });
    return execResult(run.status, run.stdout, run.stderr);
  };
  return {
    remote,
    gh,
    runtime: {
      ...base,
      exec: (request) => (request.command === "ssh" || request.command === "gh" ? answer(request) : base.exec(request)),
    },
  };
};

const project = (config = ""): Repo => {
  const repo = makeRepo({ ".finitemonkey/config.yml": `lang: en\n${config}`, "app.js": "console.log(1);\n" });
  repos.push(repo);
  return repo;
};

const checkout = (repo: Repo): string => {
  const dir = mkdtempSync(join(tmpdir(), "fm-prod-"));
  dirs.push(dir);
  const clone = spawnSync("git", ["clone", "-q", repo.root, join(dir, "app")], { encoding: "utf8" });
  assert.equal(clone.status, 0, clone.stderr);
  return join(dir, "app");
};

const ENV = { FINITEMONKEY_DEPLOY_HOST: "prod.example.com" };
const POSIX = { skip: process.platform === "win32" ? "the test server runs POSIX sh" : false };

describe("finitemonkey deploy check", POSIX, () => {
  it("reports a planted local edit on the test server, running only read commands", async () => {
    const repo = project();
    const app = checkout(repo);
    repo.write(".finitemonkey/config.yml", `lang: en\ndeploy:\n  app_dir: ${app}\n`);
    const clean = server("");
    const ok = await cliJson(["deploy", "check"], { cwd: repo.root, runtime: clean.runtime, env: ENV });
    assert.equal(ok.code, 0, ok.stdout);
    const hosts = field(ok.body, "data", "hosts");
    assert.ok(Array.isArray(hosts));
    assert.equal(field(hosts[0], "state"), "match");

    writeFileSync(join(app, "app.js"), "console.log('hotfix');\n");
    const planted = server("");
    const run = await cliJson(["deploy", "check"], { cwd: repo.root, runtime: planted.runtime, env: ENV });
    assert.equal(run.code, 1, run.stdout);
    assert.equal(field(run.body, "error", "code"), "deploy_drift_found");
    const host = field(run.body, "data", "hosts");
    assert.ok(Array.isArray(host));
    assert.equal(field(host[0], "state"), "diverged");
    assert.deepEqual(field(host[0], "edits"), ["M app.js"]);
    assert.ok(!run.stdout.includes("prod.example.com"));

    const allowed = new Set(
      [
        remoteCommand({ kind: "revisions" }),
        remoteCommand({ kind: "git-status", path: app }),
        remoteCommand({ kind: "git-head", path: app }),
      ].filter((command) => command !== undefined),
    );
    for (const command of [...clean.remote, ...planted.remote]) {
      assert.ok(allowed.has(command), command);
      assert.ok(readOnlyScript(command), command);
    }
  });

  it("compares the revision label of running containers with the branch commit", async () => {
    const repo = project();
    const head = repo.git("rev-parse", "HEAD").trim();
    const stale = server(`shop-app-1 ghcr.io/acme/shop@sha256:abc 0123456789abcdef0123456789abcdef01234567\n`);
    const diverged = await cliJson(["deploy", "check"], { cwd: repo.root, runtime: stale.runtime, env: ENV });
    assert.equal(diverged.code, 1);
    const fresh = server(`shop-app-1 ghcr.io/acme/shop@sha256:abc ${head}\n`);
    const live = await cliJson(["deploy", "check"], { cwd: repo.root, runtime: fresh.runtime, env: ENV });
    assert.equal(live.code, 0, live.stdout);
  });

  it("reuses one issue across runs", async () => {
    const repo = project();
    let open = "[]";
    const drifting = server("app img 0123456789abcdef0123456789abcdef01234567\n", () => open);
    await cli(["deploy", "check", "--issue"], { cwd: repo.root, runtime: drifting.runtime, env: ENV });
    open = JSON.stringify([{ number: 7, title: TITLE }]);
    await cli(["deploy", "check", "--issue"], { cwd: repo.root, runtime: drifting.runtime, env: ENV });
    await cli(["deploy", "check", "--issue"], { cwd: repo.root, runtime: drifting.runtime, env: ENV });
    const creates = drifting.gh.filter((args) => args[1] === "create");
    const comments = drifting.gh.filter((args) => args[1] === "comment");
    assert.equal(creates.length, 1);
    assert.ok(creates[0]?.includes(TITLE));
    assert.equal(comments.length, 2);
    assert.ok(comments.every((args) => args[2] === "7"));
    assert.ok(drifting.gh.every((args) => !args.join(" ").includes("prod.example.com")));
  });

  it("says how to configure it when there is no host", async () => {
    const repo = project();
    const run = await cliJson(["deploy", "check"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(run.body, "error", "code"), "deploy_check_unconfigured");
  });

  it("the deploy gate check fails while production runs another commit", () => {
    const repo = project();
    const created = createTask(repoRuntime(), fmPaths(repo.root), {
      id: "t1",
      goal: "ship",
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
    const stale = server("app img 0123456789abcdef0123456789abcdef01234567\n");
    const ready = prepareGate({
      runtime: stale.runtime,
      cwd: repo.root,
      env: ENV,
      sessionId: "s1",
      budgetMs: 60_000,
      fast: false,
      noSkip: true,
    });
    if (ready.kind !== "ready") throw new Error(ready.kind);
    const outcome = deployCheck({ id: "deploy", kind: "deploy" }, ready.prepared.ctx);
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.notes[0]?.key, "gate.deploy.diverged");
  });

  it("after a deploy, the report line says when production differs from the branch", async () => {
    const repo = project('deploy:\n  version_url: https://shop.example.com/version\n  drift: "true"\n');
    const head = repo.git("rev-parse", "HEAD").trim();
    const stale = server("app img 0123456789abcdef0123456789abcdef01234567\n");
    const runtime: Runtime = {
      ...stale.runtime,
      exec: (request) =>
        request.command === "curl"
          ? execResult(0, `${JSON.stringify({ commit: head })}\n200`)
          : stale.runtime.exec(request),
    };
    const run = await cli(["deploy", "status", "--report"], { cwd: repo.root, runtime, env: ENV });
    assert.match(run.stdout, /production differs from the branch on prod-1/);
  });
});
