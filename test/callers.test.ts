import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import { logEvent } from "../src/evidence/log.js";
import { callersRate, FLAGGED_EVENT, MIN_SAMPLE, RELEASED_EVENT } from "../src/gate/callers/rate.js";
import type { ReportItem } from "../src/gate/report.js";
import { runGate } from "../src/gate/run.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { readTrust, writeTrust } from "../src/task/state.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const CART = "export function total(items) {\n  return items.length;\n}\n";
const APP = 'import { total } from "./cart.js";\n\nexport const run = () => total([]);\n';

const fresh = (files: Readonly<Record<string, string>> = { "src/cart.js": CART, "src/app.js": APP }): Repo => {
  const repo = makeRepo({ ...files, "test/a.test.js": PASSING_TEST });
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
  return repo;
};

const item = (repo: Repo, fast = false): ReportItem => {
  const run = runGate({ runtime: repoRuntime(), cwd: repo.root, env: {}, sessionId: "s1", budgetMs: 60_000, fast });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  const found = run.report.items.find((entry) => entry.id === "callers");
  if (found === undefined) throw new Error("no callers item");
  return found;
};

const renameTotal = (repo: Repo): void => {
  repo.write("src/cart.js", CART.replace("total", "sum"));
};

describe("callers check", () => {
  it("case 6: renamed on one side, called by the old name on the other, clean merge, fails", () => {
    const repo = fresh();
    repo.git("switch", "-q", "-c", "other");
    repo.write("src/report.js", 'import { total } from "./cart.js";\n\nexport const report = () => total([1]);\n');
    repo.commit("report uses total");
    repo.git("switch", "-q", "main");
    repo.write("src/cart.js", CART.replace("total", "sum"));
    repo.write("src/app.js", APP.replaceAll("total", "sum"));
    repo.commit("rename total to sum");
    repo.git("merge", "-q", "--no-edit", "other");
    const result = item(repo);
    assert.equal(result.status, "failed");
    assert.ok(result.notes.some((entry) => entry.key === "gate.callers.open" && entry.params["name"] === "total"));
    assert.ok(
      result.notes.some((entry) => entry.key === "gate.callers.at" && entry.params["file"] === "src/report.js"),
    );
  });

  it("a rename with every caller updated passes", () => {
    const repo = fresh();
    renameTotal(repo);
    repo.write("src/app.js", APP.replaceAll("total", "sum"));
    assert.equal(item(repo).status, "passed");
  });

  it("an old call left in the same file fails without any import", () => {
    const repo = fresh({ "src/cart.js": `${CART}export const all = () => total([]);\n` });
    repo.write("src/cart.js", `${CART.replace("total", "sum")}export const all = () => total([]);\n`);
    assert.equal(item(repo).status, "failed");
  });

  it("a homonym in another language does not fail", () => {
    const repo = fresh({ "src/cart.js": CART, "tools/total.py": "def total(x):\n    return x\n\nprint(total(1))\n" });
    renameTotal(repo);
    assert.equal(item(repo).status, "passed");
  });

  it("a homonym in a module that does not import the origin does not fail", () => {
    const repo = fresh({
      "src/cart.js": CART,
      "src/other.js": 'import { total } from "./ledger.js";\nexport const x = total();\n',
      "src/ledger.js": "export function total() {\n  return 0;\n}\n",
    });
    renameTotal(repo);
    assert.equal(item(repo).status, "passed");
  });

  it("follows Python imports", () => {
    const repo = fresh({
      "pkg/cart.py": "def total(items):\n    return len(items)\n",
      "pkg/app.py": "from pkg.cart import total\n\nprint(total([]))\n",
      "pkg/other.py": "from pkg.ledger import total\n\nprint(total([]))\n",
    });
    repo.write("pkg/cart.py", "def sum_items(items):\n    return len(items)\n");
    const result = item(repo);
    assert.equal(result.status, "failed");
    const files = result.notes.filter((entry) => entry.key === "gate.callers.at").map((entry) => entry.params["file"]);
    assert.ok(files.includes("pkg/app.py"));
    assert.ok(!files.includes("pkg/other.py"));
  });

  it("a removed definition that moved to another changed file is not reported", () => {
    const repo = fresh();
    repo.write("src/cart.js", "export const nothing = 0;\n");
    repo.write("src/money.js", CART);
    repo.write("src/app.js", 'import { total } from "./money.js";\n\nexport const run = () => total([]);\n');
    assert.equal(item(repo).status, "passed");
  });

  it("callers_ignore in the contract releases a known dead caller and logs it", () => {
    const repo = fresh();
    const paths = fmPaths(repo.root);
    appendFileSync(paths.task("t1"), "callers_ignore: [total]\n");
    const lock = readTrust(repoRuntime(), paths);
    writeTrust(repoRuntime(), paths, {
      ...lock,
      approved: { ...lock.approved, t1: repo.read(".finitemonkey/tasks/t1.yml") },
    });
    renameTotal(repo);
    assert.equal(item(repo).status, "passed");
    const rate = callersRate(repoRuntime(), fmPaths(repo.root));
    assert.equal(rate.released, 1);
    assert.equal(rate.flagged, 1);
  });

  it("logs the flagged names so the false-positive rate can be measured", () => {
    const repo = fresh();
    renameTotal(repo);
    item(repo);
    const rate = callersRate(repoRuntime(), fmPaths(repo.root));
    assert.deepEqual([rate.flagged, rate.released], [1, 0]);
  });

  it("above 5% false positives the check becomes a warning", () => {
    const repo = fresh();
    const paths = fmPaths(repo.root);
    const runtime = repoRuntime();
    const names = Array.from({ length: MIN_SAMPLE }, (_, index) => `name${String(index)}`);
    logEvent(runtime, paths, FLAGGED_EVENT, { task: "old", names: names.slice(2) });
    logEvent(runtime, paths, RELEASED_EVENT, { task: "old", names: names.slice(0, 2) });
    renameTotal(repo);
    const result = item(repo);
    assert.equal(result.status, "passed");
    assert.equal(result.notes[0]?.key, "gate.callers.warning");
  });

  it("at or under 5% it keeps blocking", () => {
    const repo = fresh();
    const names = Array.from({ length: MIN_SAMPLE }, (_, index) => `name${String(index)}`);
    logEvent(repoRuntime(), fmPaths(repo.root), FLAGGED_EVENT, { task: "old", names });
    renameTotal(repo);
    assert.equal(item(repo).status, "failed");
  });

  it("runs in gate --fast", () => {
    const repo = fresh();
    renameTotal(repo);
    assert.equal(item(repo, true).status, "failed");
  });
});
