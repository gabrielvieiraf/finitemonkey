import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { parseParity, renderParity } from "../src/parity/table.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const legacy = (): Repo => {
  const repo = makeRepo({
    "legacy/api.js": 'app.get("/coupons", list);\napp.post("/coupons", create);\n',
    "legacy/jobs.js": 'cron.schedule("0 * * * *", expire);\n',
    "legacy/api.test.js": 'app.get("/only-in-tests", noop);\n',
    "src/new.js": "export const fresh = 1;\n",
  });
  repos.push(repo);
  return repo;
};

const kinds = async (repo: Repo): Promise<readonly string[]> => {
  const { body } = await cliJson(["parity", "check"], { cwd: repo.root, runtime: repoRuntime() });
  const issues = field(body, "data", "issues");
  return Array.isArray(issues) ? issues.map((item: unknown) => String(field({ item }, "item", "kind"))) : [];
};

const edit = (
  repo: Repo,
  change: (row: ReturnType<typeof parseParity>[number]) => ReturnType<typeof parseParity>[number],
): void => {
  repo.write("docs/plan/parity.csv", renderParity(parseParity(repo.read("docs/plan/parity.csv")).map(change)));
};

const done = (row: ReturnType<typeof parseParity>[number]) => ({
  ...row,
  destination: "src/api",
  parityTest: "test/api.parity.test.js",
  state: "green",
});

describe("parity matrix", () => {
  it("inventory --parity lists what the old code does, tests left out", async () => {
    const repo = legacy();
    const run = await cliJson(["inventory", "coupons", "--path", "legacy", "--parity"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(run.code, 0);
    const rows = parseParity(repo.read("docs/plan/parity.csv"));
    assert.deepEqual(
      rows.map((row) => [row.id, row.capability, row.whereToday, row.state]),
      [
        ["P1", 'app.get("/coupons", list);', "legacy/api.js:1", "pending"],
        ["P2", 'app.post("/coupons", create);', "legacy/api.js:2", "pending"],
        ["P3", 'cron.schedule("0 * * * *", expire);', "legacy/jobs.js:1", "pending"],
      ],
    );
    assert.deepEqual([...new Set(await kinds(repo))], ["no_destination"]);
  });

  it("a row without a test fails the check, and a placed, tested, green matrix passes", async () => {
    const repo = legacy();
    await cliJson(["parity", "init", "--path", "legacy"], { cwd: repo.root, runtime: repoRuntime() });
    edit(repo, (row) => ({ ...done(row), parityTest: row.id === "P2" ? "" : "test/api.parity.test.js" }));
    assert.deepEqual(await kinds(repo), ["no_test"]);
    edit(repo, done);
    assert.deepEqual(await kinds(repo), []);
    edit(repo, (row) => ({ ...row, state: row.id === "P1" ? "red" : row.state }));
    assert.deepEqual(await kinds(repo), ["not_green"]);
  });

  it("removed without a linked decision fails the check", async () => {
    const repo = legacy();
    await cliJson(["parity", "init", "--path", "legacy"], { cwd: repo.root, runtime: repoRuntime() });
    edit(repo, (row) => (row.id === "P3" ? { ...row, destination: "removed" } : done(row)));
    assert.deepEqual(await kinds(repo), ["removed_without_decision"]);
    edit(repo, (row) => (row.id === "P3" ? { ...row, decision: "docs/plan/04-decision-drop-expiry-job.md" } : row));
    assert.deepEqual(await kinds(repo), ["removed_without_decision"]);
    repo.write("docs/plan/04-decision-drop-expiry-job.md", "# Decision: drop the expiry job\n");
    assert.deepEqual(await kinds(repo), []);
  });

  it("the delta update adds rows for new capabilities in the old code", async () => {
    const repo = legacy();
    await cliJson(["parity", "init", "--path", "legacy"], { cwd: repo.root, runtime: repoRuntime() });
    edit(repo, done);
    repo.commit("matrix");
    repo.write(
      "legacy/api.js",
      'app.get("/coupons", list);\napp.post("/coupons", create);\napp.delete("/coupons/:id", remove);\n',
    );
    repo.write("src/new.js", 'app.get("/not-legacy", x);\n');
    repo.commit("old code still moves");
    const run = await cliJson(["parity", "update"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(run.body, "data", "added"), 1);
    const rows = parseParity(repo.read("docs/plan/parity.csv"));
    assert.deepEqual(rows.at(-1), {
      id: "P4",
      capability: 'app.delete("/coupons/:id", remove);',
      whereToday: "legacy/api.js:3",
      destination: "",
      parityTest: "",
      state: "new",
      decision: "",
    });
    assert.deepEqual(await kinds(repo), ["no_destination"]);
    const again = await cliJson(["parity", "update"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(again.body, "data", "added"), 0);
  });
});
