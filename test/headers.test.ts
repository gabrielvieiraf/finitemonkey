import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { headersCheck } from "../src/gate/checks/headers.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { probeHeaders } from "../src/headers/probe.js";
import { writeHeaders } from "../src/headers/record.js";
import { missingHeaders, parseHeaderBlock } from "../src/headers/rules.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { execResult } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SAFE = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const WITHOUT_CSP = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

describe("security headers", () => {
  it("asks once per configured route and keeps only the watched headers", async () => {
    const urls: string[] = [];
    const routes = await probeHeaders(
      (url) => {
        urls.push(url);
        return Promise.resolve({ status: 200, headers: { ...SAFE, "set-cookie": "s=1", Server: "x" } });
      },
      "http://127.0.0.1:3000",
      ["/", "/pricing", "account"],
      1000,
    );
    assert.deepEqual(urls, [
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3000/pricing",
      "http://127.0.0.1:3000/account",
    ]);
    assert.deepEqual(Object.keys(routes[0]?.headers ?? {}).sort(), Object.keys(SAFE).sort());
  });

  it("names each missing header; HSTS only counts over https", () => {
    const routes = [{ route: "/", status: 200, headers: WITHOUT_CSP }];
    assert.deepEqual(
      missingHeaders(routes, true).map((issue) => issue.rule),
      ["csp", "hsts", "frame-ancestors"],
    );
    assert.deepEqual(
      missingHeaders(routes, false).map((issue) => issue.rule),
      ["csp", "frame-ancestors"],
    );
    assert.deepEqual(missingHeaders([{ route: "/", status: 200, headers: SAFE }], true), []);
  });

  it("reads the final response after redirects from a curl header dump", () => {
    const dump = "HTTP/1.1 301 Moved\r\nLocation: /x\r\n\r\nHTTP/2 200\r\nReferrer-Policy: no-referrer\r\n\r\n";
    assert.deepEqual(parseHeaderBlock(dump), { status: 200, headers: { "referrer-policy": "no-referrer" } });
  });
});

const project = (level: number, config = ""): Repo => {
  const repo = makeRepo({
    ".finitemonkey/config.yml": `lang: en\n${config}`,
    ".finitemonkey/infra.yml": `schema: finitemonkey/infra@1\nlevel: ${String(level)}\nlevel_source: confirmed\n`,
    "app.js": "x\n",
  });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "headers",
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

const context = (repo: Repo, runtime: Runtime = repoRuntime()): GateContext => {
  const ready = prepareGate({
    runtime,
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

const CHECK = { id: "headers", kind: "headers" as const };

const withRecorded = (repo: Repo, headers: Readonly<Record<string, string>>): GateContext => {
  const ctx = context(repo);
  writeHeaders(repoRuntime(), fmPaths(repo.root), ctx.treeHash, {
    at: "2026-10-28T12:00:00.000Z",
    https: false,
    routes: [{ route: "/", status: 200, headers }],
  });
  return ctx;
};

describe("gate check headers", () => {
  it("a missing header fails at level 2 and only warns at level 1", () => {
    const blocked = headersCheck(CHECK, withRecorded(project(2), WITHOUT_CSP));
    assert.equal(blocked.status, "failed");
    assert.deepEqual(
      blocked.notes.map((item) => item.key),
      ["gate.headers.missing.csp", "gate.headers.missing.frame-ancestors"],
    );
    const warned = headersCheck(CHECK, withRecorded(project(1), WITHOUT_CSP));
    assert.equal(warned.status, "passed");
    assert.equal(warned.notes[0]?.key, "gate.headers.warn_only");
    assert.equal(headersCheck(CHECK, withRecorded(project(2), SAFE)).status, "passed");
  });

  it("with headers.url, makes exactly one request per configured route", () => {
    const repo = project(2, "headers:\n  url: https://shop.example.com\n  routes:\n    - /\n    - /checkout\n");
    const calls: ExecRequest[] = [];
    const base = repoRuntime();
    const dump = ["HTTP/2 200", ...Object.entries(SAFE).map(([name, value]) => `${name}: ${value}`), "", ""].join(
      "\r\n",
    );
    const runtime: Runtime = {
      ...base,
      exec: (request) => {
        if (request.command !== "curl") return base.exec(request);
        calls.push(request);
        return execResult(0, dump);
      },
    };
    const outcome = headersCheck(CHECK, context(repo, runtime));
    assert.equal(outcome.status, "passed", JSON.stringify(outcome.notes));
    assert.deepEqual(
      calls.map((call) => call.args.at(-1)),
      ["https://shop.example.com/", "https://shop.example.com/checkout"],
    );
  });
});
