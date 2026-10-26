import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:http";
import { connect } from "node:net";
import { after, describe, it } from "node:test";

import type { ReportItem } from "../src/gate/report.js";
import { runGate } from "../src/gate/run.js";
import { contractHash, parseContract } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, readTrust, writeState, writeTrust } from "../src/task/state.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SERVER = (status: number, body: string): string =>
  [
    'const http = require("node:http");',
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    'fs.writeFileSync("pids.txt", `${process.pid}\\n${child.pid}\\n`);',
    `http.createServer((req, res) => { res.statusCode = ${String(status)}; res.end(${JSON.stringify(body)}); })`,
    '  .listen(Number(process.env.PORT), "127.0.0.1");',
    "",
  ].join("\n");

const FILES = {
  "ok.js": SERVER(200, "hello monkey"),
  "broken.js": SERVER(500, "oops"),
  "crash.js": 'throw new Error("boom at boot");\n',
  "src/a.js": "export const a = 1;\n",
  ".gitignore": "pids.txt\n",
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === "string") reject(new Error("no port"));
        else resolve(address.port);
      });
    });
  });

interface RuntimeSpec {
  readonly run: string;
  readonly port: number;
  readonly status?: number;
  readonly body?: string;
}

const contract = (repo: Repo, spec: RuntimeSpec): void => {
  const lines = [
    "id: t1",
    "goal: the app boots",
    "size: S",
    `base: ${repo.git("rev-parse", "HEAD").trim()}`,
    "acceptance:",
    "  - id: app",
    "    check: runtime",
    `    run: ${spec.run}`,
    `    port: ${String(spec.port)}`,
    "    route: /health",
    `    status: ${String(spec.status ?? 200)}`,
    ...(spec.body === undefined ? [] : [`    body: ${spec.body}`]),
    "    timeout_s: 20",
    "",
  ];
  const text = lines.join("\n");
  const parsed = parseContract("t1", text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  runtime.writeText(paths.task("t1"), text);
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, t1: contractHash(parsed.value) },
    approved: { ...lock.approved, t1: text },
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: "t1" });
};

const fresh = async (spec: Omit<RuntimeSpec, "port">): Promise<{ readonly repo: Repo; readonly port: number }> => {
  const repo = makeRepo(FILES);
  repos.push(repo);
  const port = await freePort();
  contract(repo, { ...spec, port });
  repo.write("src/a.js", "export const a = 2;\n");
  return { repo, port };
};

const item = (repo: Repo): ReportItem => {
  const run = runGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 120_000,
    fast: false,
  });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  const found = run.report.items.find((entry) => entry.id === "app");
  if (found === undefined) throw new Error("no app item");
  return found;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const settle = async (pids: readonly number[]): Promise<boolean> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (pids.every((pid) => !alive(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return pids.every((pid) => !alive(pid));
};

const listen = async (port: number): Promise<ChildProcess> => {
  const source = `require("node:http").createServer((q, r) => r.end("already up")).listen(${String(port)}, "127.0.0.1")`;
  const child = spawn(process.execPath, ["-e", source], { stdio: "ignore" });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        resolve(false);
      });
    });
    if (open) return child;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not start");
};

describe("runtime check", () => {
  it("passes when the app starts and the route answers as declared", async () => {
    const { repo } = await fresh({ run: "node ok.js", body: "hello" });
    const result = item(repo);
    assert.equal(result.status, "passed", JSON.stringify(result.notes));
    assert.equal(result.command, "node ok.js");
    assert.equal(result.exitCode, 0);
  });

  it("fails when the app crashes on boot, with the exit code and the last output line", async () => {
    const { repo } = await fresh({ run: "node crash.js" });
    const result = item(repo);
    assert.equal(result.status, "failed");
    assert.equal(result.notes[0]?.key, "gate.runtime.crashed");
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.notes.some((entry) => String(entry.params["line"] ?? "").includes("boom at boot")));
  });

  it("fails on a wrong status code", async () => {
    const { repo } = await fresh({ run: "node broken.js" });
    const result = item(repo);
    assert.equal(result.status, "failed");
    assert.deepEqual(result.notes[0], {
      key: "gate.runtime.wrong_status",
      params: { route: "/health", status: 500, expected: 200 },
    });
  });

  it("fails when the body does not match", async () => {
    const { repo } = await fresh({ run: "node ok.js", body: "goodbye" });
    assert.equal(item(repo).notes[0]?.key, "gate.runtime.body_mismatch");
  });

  it("leaves no process behind: the app and the child it spawned are gone", async () => {
    const { repo } = await fresh({ run: "node ok.js" });
    assert.equal(item(repo).status, "passed");
    const pids = repo
      .read("pids.txt")
      .split("\n")
      .filter((line) => line !== "")
      .map(Number);
    assert.equal(pids.length, 2);
    assert.ok(await settle(pids), `still alive: ${pids.filter(alive).join(", ")}`);
  });

  it("reuses an app already listening on the declared port without starting another", async () => {
    const { repo, port } = await fresh({ run: "node crash.js", body: "already" });
    const server = await listen(port);
    try {
      const result = item(repo);
      assert.equal(result.status, "passed", JSON.stringify(result.notes));
      assert.equal(result.notes[0]?.key, "gate.runtime.reused");
    } finally {
      server.kill();
    }
  });

  it("an untrusted contract does not start anything", async () => {
    const { repo } = await fresh({ run: "node ok.js" });
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    writeTrust(runtime, paths, { ...readTrust(runtime, paths), contracts: {} });
    assert.equal(item(repo).reason, "untrusted");
  });
});
