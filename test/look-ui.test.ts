import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { copyCheck } from "../src/gate/checks/copy.js";
import { prepareGate } from "../src/gate/prepare.js";
import { latestLayouts, readApproved, writeLayouts } from "../src/look/approved.js";
import { catalogMatches } from "../src/look/copy.js";
import { repeatedLayouts, similarity } from "../src/look/layout.js";
import type { PageResult } from "../src/look/node-capture.js";
import { DEFAULT_CATALOGS, DEFAULT_DRIFT } from "../src/look/ui.js";
import { uiFindings } from "../src/look/ui-findings.js";
import { draftChecks } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, fakeRuntime, field, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const UI = { bannedCopy: ["processed by Stripe", "fictitious data"], catalogs: DEFAULT_CATALOGS, drift: DEFAULT_DRIFT };
const LIST = ["header", "nav", "main", "h1", "section", "h2", "ul", "section", "h2", "table", "footer"];
const FORM = ["header", "nav", "main", "h1", "form", "h2", "footer"];

const page = (route: string, structure: readonly string[], text = "", viewport = 1440): PageResult => ({
  route,
  viewport,
  path: `/tmp/${route}.png`,
  consoleErrors: [],
  failedRequests: [],
  loadError: undefined,
  measure: { overflow: 0, keys: [], small: [], broken: [], text, structure },
});

describe("look: banned interface copy", () => {
  it("finds a banned phrase in a JSON catalog with the file and the key", () => {
    const catalog = JSON.stringify({ checkout: { footer: "Payment processed by  Stripe", title: "Checkout" } });
    assert.deepEqual(catalogMatches("src/locales/en.json", catalog, UI.bannedCopy), [
      { file: "src/locales/en.json", key: "checkout.footer", phrase: "processed by Stripe" },
    ]);
  });

  it("a banned phrase in a catalog fails the copy check with the file and key", () => {
    const repo = makeRepo({
      "README.md": "# shop\n",
      ".finitemonkey/config.yml": "lang: en\nui:\n  banned_copy:\n    - processed by Stripe\n",
      "src/locales/pt-BR.json": JSON.stringify({ checkout: { footer: "Pagamento processed by Stripe" } }),
    });
    repos.push(repo);
    const ready = prepareGate({
      runtime: repoRuntime(),
      cwd: repo.root,
      env: {},
      sessionId: undefined,
      budgetMs: 1000,
      fast: true,
      noSkip: true,
    });
    if (ready.kind !== "ready") throw new Error(ready.kind);
    const outcome = copyCheck({ id: "copy", kind: "copy" }, ready.prepared.ctx);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(outcome.notes[0]?.params, {
      file: "src/locales/pt-BR.json",
      key: "checkout.footer",
      phrase: "processed by Stripe",
    });
    repo.write(".finitemonkey/policy.yml", "guards:\n  ui-review: shadow\n");
    assert.equal(copyCheck({ id: "copy", kind: "copy" }, ready.prepared.ctx).status, "passed");
  });

  it("new contracts get the copy check when config.yml lists banned copy", () => {
    const root = toAbsolutePath("/home/ana/project");
    const fs = memoryFs({
      [toAbsolutePath(join(root, ".finitemonkey", "config.yml"))]: "ui:\n  banned_copy: [fictitious data]\n",
    });
    const draft = {
      id: "t",
      goal: "g",
      size: "S",
      base: undefined,
      paths: [],
      runs: [],
      tests: undefined,
      git: [],
      manual: [],
      budget: undefined,
    } as const;
    assert.ok(draftChecks(fakeRuntime({ fs }), fmPaths(root), draft).some((check) => check.kind === "copy"));
  });

  it("text on a rendered screen is checked against the same list", () => {
    const found = uiFindings([page("/pay", FORM, "Total\nfictitious data for the demo")], UI, [], "active");
    assert.deepEqual(
      found.map((item) => [item.rule, item.blocking]),
      [["look/banned-copy", true]],
    );
  });
});

describe("look: approved screens and repeated layouts", () => {
  it("compares a capture with the approved reference of the same route and flags a large change", () => {
    const approved = [{ route: "/plans", viewport: 1440, structure: LIST, at: "2026-10-20T10:00:00.000Z" }];
    assert.deepEqual(uiFindings([page("/plans", LIST)], UI, approved, "active"), []);
    const drifted = uiFindings([page("/plans", FORM)], UI, approved, "active");
    assert.equal(drifted[0]?.rule, "look/drift");
    assert.match(drifted.map((item) => item.detail).join(" "), /% like the screen approved at 2026-10-20/);
    assert.ok(similarity(LIST, FORM) < DEFAULT_DRIFT);
  });

  it("two pages with the same section sequence produce a warning, mock variants do not", () => {
    const pages = [page("/plans", LIST), page("/plans?mock=empty", LIST), page("/invoices", LIST), page("/pay", FORM)];
    const layouts = pages.map((item) => ({
      route: item.route,
      viewport: item.viewport,
      structure: item.measure?.structure ?? [],
    }));
    assert.deepEqual(repeatedLayouts(layouts), [["/plans", "/invoices"]]);
    const warned = uiFindings(pages, UI, [], "active").filter((item) => item.rule === "look/repeated-layout");
    assert.deepEqual(
      warned.map((item) => [item.route, item.blocking]),
      [["/invoices", false]],
    );
  });

  it("shadow keeps the findings but never blocks, off drops them", () => {
    const pages = [page("/pay", FORM, "processed by stripe")];
    assert.deepEqual(
      uiFindings(pages, UI, [], "shadow").map((item) => item.blocking),
      [false],
    );
    assert.deepEqual(uiFindings(pages, UI, [], "off"), []);
  });

  it("look approve stores the last captures of the route, only for the person", async () => {
    const root = toAbsolutePath("/home/ana/project");
    const fs = memoryFs({ [toAbsolutePath(join(root, ".git", "HEAD"))]: "ref: refs/heads/main\n" });
    const runtime = fakeRuntime({ fs });
    const paths = fmPaths(root);
    writeLayouts(runtime, paths, "tree1", [
      { route: "/plans", viewport: 1440, structure: LIST },
      { route: "/plans", viewport: 390, structure: LIST },
    ]);
    assert.equal(latestLayouts(runtime, paths).length, 2);
    const refused = await cliJson(["look", "approve", "/plans"], { cwd: root, runtime });
    assert.notEqual(refused.code, 0);
    const stdin = Object.assign(stdinFrom(""), { isTTY: true });
    const done = await cliJson(["look", "approve", "/plans"], { cwd: root, runtime, stdin });
    assert.equal(done.code, 0, done.stdout);
    assert.deepEqual(field(done.body, "data", "viewports"), [1440, 390]);
    assert.deepEqual(
      readApproved(runtime, paths).map((screen) => [screen.route, screen.viewport]),
      [
        ["/plans", 1440],
        ["/plans", 390],
      ],
    );
    const missing = await cliJson(["look", "approve", "/nope"], { cwd: root, runtime, stdin });
    assert.notEqual(missing.code, 0);
  });
});
