import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { check as prettierCheck } from "prettier";

import { logModule, planFile, scrubModule } from "../src/observe/templates.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
const dirs: string[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const CANARY = "zq7canary41f";

const SERVER = `
import http from "node:http";
import { appendFileSync } from "node:fs";
import { log } from "./observability/log.mjs";
import { scrubEvent } from "./observability/scrub.mjs";

const reports = process.argv[2];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const data = JSON.parse(body);
    const error = new Error("payment failed for " + data.email + ": " + data.note);
    log("error", "payment.failed", {
      route: req.url, method: req.method, status: 500, errorType: error.name, userId: "u_1",
      body: data, email: data.email, message: error.message, headers: req.headers,
    });
    const event = {
      message: error.message,
      request: { method: req.method, url: req.url, data, headers: req.headers, cookies: "s=" + data.note, query_string: req.url.split("?")[1] },
      user: { id: "u_1", email: data.email, ip_address: "203.0.113.9" },
      exception: { values: [{ type: error.name, value: error.message }] },
      breadcrumbs: [{ category: "http", message: data.note, data: { body } }],
      extra: { body },
      contexts: { payload: data },
      tags: { customer: data.email, plan: "pro" },
    };
    appendFileSync(reports, JSON.stringify(scrubEvent(event)) + "\\n");
    res.writeHead(500);
    res.end("error");
  });
});
server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ port: server.address().port })));
`;

const startApi = async (dir: string, reports: string) => {
  const child = spawn(process.execPath, ["server.mjs", reports], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.setEncoding("utf8");
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      const first = /\{"port":(\d+)\}/.exec(out);
      if (first !== null) resolve(Number(first[1]));
    });
    child.on("exit", () => {
      reject(new Error(`the API exited: ${out}`));
    });
  });
  const stop = async (): Promise<string> => {
    const closed = new Promise((resolve) => child.on("close", resolve));
    child.kill();
    await closed;
    return out;
  };
  return { port, stop };
};

describe("observability templates", () => {
  it("a canary sent through the API reaches neither the logs nor the error reports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-observe-"));
    dirs.push(dir);
    mkdirSync(join(dir, "observability"));
    writeFileSync(join(dir, "observability", "scrub.mjs"), scrubModule());
    writeFileSync(join(dir, "observability", "log.mjs"), logModule());
    writeFileSync(join(dir, "server.mjs"), SERVER);
    const reports = join(dir, "reports.jsonl");
    const api = await startApi(dir, reports);
    try {
      const response = await fetch(`http://127.0.0.1:${String(api.port)}/api/pay?note=${CANARY}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-customer-note": CANARY, cookie: `s=${CANARY}` },
        body: JSON.stringify({ email: `${CANARY}@example.com`, note: `card for ${CANARY}`, amount: 4200 }),
      });
      assert.equal(response.status, 500);
    } finally {
      const logs = await api.stop();
      const report = readFileSync(reports, "utf8");
      assert.match(logs, /"event":"payment\.failed"/);
      assert.match(logs, /"route":"\/api\/pay"/);
      assert.match(report, /"type":"Error"/);
      assert.match(report, /"id":"u_1"/);
      assert.ok(!logs.includes(CANARY), logs);
      assert.ok(!report.includes(CANARY), report);
    }
  });

  it("the generated files are prettier-clean", async () => {
    assert.ok(await prettierCheck(scrubModule(), { parser: "babel" }));
    assert.ok(await prettierCheck(logModule(), { parser: "babel" }));
    assert.ok(await prettierCheck(planFile(2), { parser: "yaml" }));
  });
});

const project = (files: Readonly<Record<string, string>>): Repo => {
  const repo = makeRepo({ Dockerfile: "FROM node:22\nUSER node\n", ...files });
  repos.push(repo);
  return repo;
};

describe("finitemonkey observe", () => {
  it("lists what exists for level 1 and writes only the missing files with --yes", async () => {
    const repo = project({
      "package.json": '{ "dependencies": { "@sentry/node": "^9.0.0" } }\n',
      "observability/log.mjs": "export const log = () => undefined;\n",
    });
    const preview = await cliJson(["observe"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(preview.body, "data", "level"), 1);
    const items = field(preview.body, "data", "items");
    assert.ok(Array.isArray(items));
    const state = (item: string): unknown =>
      field(
        items.find((row) => field(row, "item") === item),
        "state",
      );
    assert.equal(state("error-tracking"), "exists");
    assert.equal(state("json-logs"), "exists");
    assert.equal(state("scrubber"), "generated");
    assert.equal(state("alerts-team"), "person");
    assert.equal(preview.body["next"], "finitemonkey observe --yes");
    assert.throws(() => repo.read("observability/scrub.mjs"));
    const done = await cli(["observe", "--yes"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(done.code, 0, done.stdout);
    assert.match(done.stdout, /signs up for no service/);
    assert.equal(repo.read("observability/scrub.mjs"), scrubModule());
    assert.equal(repo.read("observability/log.mjs"), "export const log = () => undefined;\n");
    assert.throws(() => repo.read("observability/plan.yml"));
  });

  it("level 2 adds releases, retention, synthetic checks and alert owners", async () => {
    const repo = project({ "infra/main.tf": 'resource "x" "y" {}\n' });
    await cli(["observe", "--yes"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(repo.read("observability/plan.yml"), /retention_days: null/);
  });
});
