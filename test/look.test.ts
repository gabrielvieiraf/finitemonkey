import assert from "node:assert/strict";
import { existsSync, utimesSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { ReportItem } from "../src/gate/report.js";
import { runGate } from "../src/gate/run.js";
import { saveRelease } from "../src/guards/release/grants.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { approveRoute, latestLayouts, readApproved } from "../src/look/approved.js";
import { launchBrowser, loadPlaywright } from "../src/look/node-playwright.js";
import { readLookReads, recordLookRead } from "../src/look/reads.js";
import { type LookRun, runLook } from "../src/look/run.js";
import { contractHash, parseContract } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, readTrust, writeState, writeTrust } from "../src/task/state.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, ROOT, stdinFrom } from "./support.js";

const PAGES: Readonly<Record<string, string>> = {
  "/": '<main><h1>Home</h1><button style="width:120px;height:48px">Buy</button></main>',
  "/overflow": '<main><div style="width:2400px;height:20px;background:#c00">wide</div></main>',
  "/console": '<main><h1>Console</h1><script>console.error("boom in the page")</script></main>',
  "/i18n": "<main><h1>checkout.title</h1></main>",
  "/stripe": "<main><h1>Pay</h1><p>Payment processed by Stripe</p></main>",
};

const SERVER = [
  'const http = require("node:http");',
  `const pages = ${JSON.stringify(PAGES)};`,
  "http.createServer((req, res) => {",
  '  const page = pages[(req.url || "/").split("?")[0]];',
  '  if (page === undefined) { res.statusCode = 404; res.end("missing"); return; }',
  '  res.setHeader("content-type", "text/html");',
  '  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>${page}</body></html>`);',
  '}).listen(Number(process.env.PORT), "127.0.0.1");',
  "",
].join("\n");

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === "string") reject(new Error("no port"));
        else resolve(address.port);
      });
    });
  });

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  const playwright = await loadPlaywright(ROOT);
  const launched = playwright === undefined ? undefined : await launchBrowser(playwright);
  browser = launched !== undefined;
  await launched?.close();
  if (!browser && process.env["CI"] !== undefined) throw new Error("no browser for look tests in CI");
});

const lookYml = (port: number, routes: readonly string[], extra: readonly string[] = []): string =>
  [
    `port: ${String(port)}`,
    "start: node server.js",
    "routes:",
    ...routes.map((route) => `  - ${route}`),
    ...extra,
    "",
  ].join("\n");

const contract = (repo: Repo): void => {
  const text = ["id: t1", "goal: screens", "size: S", "acceptance:", "  - id: look", "    check: look", ""].join("\n");
  const parsed = parseContract("t1", text);
  if (!parsed.ok) throw new Error("bad contract");
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

const fresh = async (routes: readonly string[], extra: readonly string[] = []): Promise<Repo> => {
  const port = await freePort();
  const repo = makeRepo({
    "server.js": SERVER,
    "src/page.tsx": "export const Page = () => null;\n",
    ".finitemonkey/look.yml": lookYml(port, routes, extra),
  });
  repos.push(repo);
  contract(repo);
  repo.write("src/page.tsx", "export const Page = () => 1;\n");
  return repo;
};

const done = (run: LookRun) => {
  if (run.kind !== "done") throw new Error(`look did not finish: ${JSON.stringify(run)}`);
  return run;
};

const rules = (run: ReturnType<typeof done>, route: string): readonly string[] =>
  run.summary.findings.filter((item) => item.route === route && item.blocking).map((item) => item.rule);

const lookItem = (repo: Repo): ReportItem => {
  const run = runGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
  });
  if (run.kind !== "done") throw new Error("gate did not run");
  const item = run.report.items.find((entry) => entry.id === "look");
  if (item === undefined) throw new Error("no look item");
  return item;
};

const openAll = (repo: Repo, run: ReturnType<typeof done>): void => {
  for (const capture of run.summary.captures) recordLookRead(repoRuntime(), fmPaths(repo.root), capture.path);
};

describe("look", () => {
  it("fails overflow, console error and untranslated key pages, each with its rule id", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fresh(["/", "/overflow", "/console", "/i18n"]);
    const run = done(await runLook(repoRuntime(), repo.root));
    assert.deepEqual(rules(run, "/"), []);
    assert.ok(rules(run, "/overflow").includes("look/overflow"));
    assert.ok(rules(run, "/console").includes("look/console-error"));
    assert.ok(rules(run, "/i18n").includes("look/i18n-key"));
    assert.ok(run.summary.failures >= 3);
    assert.equal(lookItem(repo).status, "failed");
  });

  it("writes a capture per route and width, a contact sheet and a JSON summary", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fresh(["/"]);
    const result = await cliJson(["look"], { runtime: repoRuntime(), cwd: repo.root });
    assert.equal(result.code, 0, result.stdout);
    const captures = field(result.body, "data", "captures");
    assert.deepEqual(Array.isArray(captures) && captures.map((path) => String(path).replace(/^.*\//, "")), [
      "root-1440.png",
      "root-390.png",
    ]);
    const sheet = String(field(result.body, "data", "contactSheet"));
    const summary = String(field(result.body, "data", "summary"));
    assert.ok(existsSync(join(repo.root, sheet)));
    assert.ok(existsSync(join(repo.root, summary)));
    assert.ok(result.stdout.length < 2000);
    assert.ok(!result.stdout.includes("base64"));
  });

  it("a capture not opened after the last edit keeps the check red", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fresh(["/"]);
    const run = done(await runLook(repoRuntime(), repo.root));
    assert.equal(lookItem(repo).notes[0]?.key, "gate.look.unopened");
    openAll(repo, run);
    assert.equal(lookItem(repo).status, "passed");
    const later = new Date(Date.now() + 5000);
    utimesSync(join(repo.root, "src/page.tsx"), later, later);
    const item = lookItem(repo);
    assert.equal(item.status, "failed");
    assert.equal(item.notes[0]?.key, "gate.look.unopened");
    repo.write("src/page.tsx", "export const Page = () => 2;\n");
    assert.equal(lookItem(repo).notes[0]?.key, "gate.look.not_run");
  });

  it("an allow list entry counts only when its decision is recorded", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fresh(["/overflow"], ["allow:", "  look/overflow:", "    - /overflow D-wide-table"]);
    const ignored = done(await runLook(repoRuntime(), repo.root));
    assert.ok(rules(ignored, "/overflow").includes("look/overflow"));
    assert.deepEqual(ignored.summary.ignoredAllows, ["look/overflow /overflow D-wide-table"]);
    saveRelease(repoRuntime(), fmPaths(repo.root), Date.now(), {
      grants: [],
      approvals: [{ task: "t1", check: "D-wide-table", reason: "legacy table", at: new Date().toISOString() }],
    });
    const accepted = done(await runLook(repoRuntime(), repo.root));
    assert.deepEqual(rules(accepted, "/overflow"), []);
    assert.equal(accepted.summary.findings.find((item) => item.rule === "look/overflow")?.allowedBy, "D-wide-table");
  });

  it("a Read of a capture in PostToolUse is recorded, other reads are not", async () => {
    const repo = makeRepo({ "a.txt": "a\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const read = (file: string) =>
      runHook("PostToolUse", {
        stdin: stdinFrom(
          JSON.stringify({
            session_id: "s1",
            cwd: repo.root,
            hook_event_name: "PostToolUse",
            tool_name: "Read",
            tool_input: { file_path: file },
          }),
        ),
        deadlineMs: 10_000,
        handlers: DEFAULT_HANDLERS,
        cwd: repo.root,
        t: createTranslator("en"),
        startTimer: runtime.startTimer,
        runtime,
        env: {},
      });
    await read(join(repo.root, ".finitemonkey", "look", "w1", "root-390.png"));
    await read(join(repo.root, "a.txt"));
    assert.deepEqual(Object.keys(readLookReads(runtime, fmPaths(repo.root))), [".finitemonkey/look/w1/root-390.png"]);
  });
});

describe("look: banned copy and approved screens", () => {
  it("flags a banned phrase on the screen and compares the next capture with the approved one", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const repo = await fresh(["/", "/stripe"]);
    repo.write(".finitemonkey/config.yml", "lang: en\nui:\n  banned_copy:\n    - processed by Stripe\n");
    const first = done(await runLook(repoRuntime(), repo.root));
    assert.deepEqual([...new Set(rules(first, "/stripe"))], ["look/banned-copy"]);
    const paths = fmPaths(repo.root);
    assert.equal(approveRoute(repoRuntime(), paths, "/", latestLayouts(repoRuntime(), paths)).length, 2);
    const same = done(await runLook(repoRuntime(), repo.root));
    assert.ok(!same.summary.findings.some((item) => item.rule === "look/drift"));
    const other = readApproved(repoRuntime(), paths).map((screen) => ({
      ...screen,
      structure: ["header", "nav", "main", "section", "table", "section", "form", "footer"],
    }));
    repo.write(".finitemonkey/look/approved.json", JSON.stringify({ screens: other }));
    const drifted = done(await runLook(repoRuntime(), repo.root));
    assert.ok(drifted.summary.findings.some((item) => item.rule === "look/drift" && item.route === "/"));
  });
});
