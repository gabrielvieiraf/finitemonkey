import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { LANGUAGES } from "../src/gate/callers/languages.js";
import type { RemovedSymbol } from "../src/gate/callers/scan.js";
import { syntaxSitesIn } from "../src/gate/callers/syntax.js";
import type { ReportItem } from "../src/gate/report.js";
import { runGate } from "../src/gate/run.js";
import { loadTypescript } from "../src/quality/ts-api.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { ROOT } from "./support.js";

const ts = loadTypescript(ROOT);
const js = LANGUAGES.find((language) => language.id === "js");
if (ts === undefined || js === undefined) throw new Error("the TypeScript compiler ships with the dev dependencies");

const total: RemovedSymbol = { name: "total", language: js, origins: ["src/cart.js"] };

const lines = (file: string, text: string): readonly number[] =>
  syntaxSitesIn(ts, file, text, total).map((site) => site.line);

describe("callers through the TypeScript compiler API", () => {
  it("finds the callers of a renamed function, through an alias, and skips strings and comments", () => {
    const text = [
      'import { total as count } from "./cart.js";',
      "",
      "// total is gone",
      'const label = "total";',
      "export const run = () => count([]);",
      "export const keep = { count };",
    ].join("\n");
    assert.deepEqual(lines("src/app.js", text), [1, 5, 6]);
  });

  it("follows namespace imports and re-exports", () => {
    const text = ['import * as cart from "./cart.js";', "cart.total([]);", 'export { total } from "./cart.js";'].join(
      "\n",
    );
    assert.deepEqual(lines("src/app.ts", text), [2, 3]);
  });

  it("ignores the same name taken from another module or declared locally", () => {
    const other = 'import { total } from "./other.js";\nexport const run = () => total([]);\n';
    assert.deepEqual(lines("src/app.js", other), []);
    const local = "const total = (items) => items.length;\nexport const run = () => total([]);\n";
    assert.deepEqual(lines("src/app.js", local), []);
  });

  it("finds a leftover use in the file that lost the definition", () => {
    assert.deepEqual(lines("src/cart.js", "export function sum(items) {\n  return total(items);\n}\n"), [2]);
  });
});

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const CART = "export function total(items) {\n  return items.length;\n}\n";
const APP = 'import { total as count } from "./cart.js";\n\nexport const run = () => count([]);\n';

const item = (repo: Repo): ReportItem => {
  const run = runGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
  });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  const found = run.report.items.find((entry) => entry.id === "callers");
  if (found === undefined) throw new Error("no callers item");
  return found;
};

describe("callers check with callers-syntax active", () => {
  it("fails on the aliased call site of a renamed function", () => {
    const repo = makeRepo({
      "src/cart.js": CART,
      "src/app.js": APP,
      "test/a.test.js": PASSING_TEST,
      ".finitemonkey/policy.yml": "guards:\n  callers-syntax: active\n",
    });
    repos.push(repo);
    const created = createTask(repoRuntime(), fmPaths(repo.root), {
      id: "t1",
      goal: "rename total",
      size: "S",
      base: repo.git("rev-parse", "HEAD").trim(),
      paths: [],
      runs: [],
      tests: "node --test",
      git: [],
      manual: [],
      budget: undefined,
    });
    assert.ok(created.ok);
    repo.write("src/cart.js", CART.replace("total", "sum"));
    const outcome = item(repo);
    assert.equal(outcome.status, "failed");
    const at = outcome.notes.filter((entry) => entry.key === "gate.callers.at").map((entry) => entry.params["line"]);
    assert.deepEqual(at, [1, 3]);
  });
});
