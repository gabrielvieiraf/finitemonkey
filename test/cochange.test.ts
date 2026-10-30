import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { cochangeCheck } from "../src/gate/checks/cochange.js";
import { gitAt } from "../src/gate/git.js";
import { prepareGate } from "../src/gate/prepare.js";
import {
  type Commit,
  dismissPair,
  historyOf,
  missingPartners,
  notDismissed,
  readDismissed,
} from "../src/git/cochange.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const commit = (hash: string, ...files: readonly string[]): Commit => ({ hash, files });

const coupled = (): Repo => {
  const repo = makeRepo({
    ".gitignore": ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/policy.yml\n",
    ".finitemonkey/config.yml": "lang: en\n",
    "i18n/en.json": "{}\n",
    "src/catalog.ts": "export const keys = [];\n",
    "src/other.ts": "export const x = 0;\n",
  });
  repos.push(repo);
  for (let round = 1; round <= 5; round += 1) {
    repo.write("i18n/en.json", `{"k${String(round)}": "v"}\n`);
    repo.write("src/catalog.ts", `export const keys = [${String(round)}];\n`);
    repo.commit(`add key ${String(round)}`);
  }
  repo.write("src/other.ts", "export const x = 1;\n");
  repo.commit("other");
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "add a message",
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
  repo.write(".finitemonkey/policy.yml", "guards:\n  cochange: active\n");
  return repo;
};

const run = (repo: Repo) => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  assert.ok(ready.prepared.ctx.contract.acceptance.some((check) => check.kind === "cochange"));
  return cochangeCheck({ id: "cochange", kind: "cochange" }, ready.prepared.ctx);
};

describe("co-change pairs", () => {
  it("lockfiles, changelogs and bulk commits never create pairs", () => {
    const history = [1, 2, 3, 4, 5].flatMap((index) => [
      commit(`a${String(index)}`, "src/a.ts", "package-lock.json", "CHANGELOG.md"),
      commit(`b${String(index)}`, ...Array.from({ length: 40 }, (_, file) => `bulk/f${String(file)}.ts`), "src/a.ts"),
    ]);
    assert.deepEqual(missingPartners(history, ["src/a.ts"]), []);
    assert.deepEqual(missingPartners(history, ["package-lock.json"]), []);
  });

  it("a pair below the support or confidence threshold stays quiet", () => {
    const history = [
      commit("c1", "a.ts", "b.ts"),
      commit("c2", "a.ts", "b.ts"),
      commit("c3", "a.ts", "b.ts"),
      commit("c4", "a.ts", "c.ts"),
    ];
    assert.deepEqual(missingPartners(history, ["a.ts"]), []);
  });
});

describe("cochange gate check", () => {
  it("warns when the catalog changes without its loader and lists the commits behind it", () => {
    const repo = coupled();
    repo.write("i18n/en.json", '{"k6": "v"}\n');
    const outcome = run(repo);
    assert.equal(outcome.status, "passed");
    const partner = outcome.notes.find((item) => item.key === "gate.cochange.partner");
    assert.ok(partner);
    assert.equal(partner.params["partner"], "src/catalog.ts");
    assert.equal(partner.params["support"], 6);
    const listed = String(partner.params["commits"]).split(", ");
    assert.equal(listed.length, 5);
    assert.ok(listed.every((hash) => repo.git("cat-file", "-t", hash).trim() === "commit"));
  });

  it("a dismissed pair stays silent until its history changes", () => {
    const repo = coupled();
    const paths = fmPaths(repo.root);
    const runtime = repoRuntime();
    const commits = historyOf(runtime, paths, gitAt(runtime, repo.root));
    dismissPair(runtime, paths, commits, ["src/catalog.ts", "i18n/en.json"], "the loader reads keys lazily now");
    repo.write("i18n/en.json", '{"k6": "v"}\n');
    assert.equal(
      run(repo).notes.some((item) => item.key === "gate.cochange.partner"),
      false,
    );
    const moved = [...commits, commit("f".repeat(40), "src/catalog.ts", "i18n/en.json")];
    const dismissed = readDismissed(runtime, paths);
    assert.equal(notDismissed(missingPartners(commits, ["i18n/en.json"]), dismissed).length, 0);
    assert.equal(notDismissed(missingPartners(moved, ["i18n/en.json"]), dismissed).length, 1);
  });
});
