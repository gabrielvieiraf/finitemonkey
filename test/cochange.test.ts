import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { cochangeCheck } from "../src/gate/checks/cochange.js";
import { gitAt } from "../src/gate/git.js";
import { prepareGate } from "../src/gate/prepare.js";
import {
  type Commit,
  DEFAULT_OPTIONS,
  dismissPair,
  missingPartners,
  notDismissed,
  readDismissed,
} from "../src/git/cochange.js";
import { historyOf } from "../src/git/cochange-history.js";
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
    ".gitignore": ".fm/*\n!.fm/config.yml\n!.fm/policy.yml\n",
    ".fm/config.yml": "lang: en\n",
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
  repo.write(".fm/policy.yml", "guards:\n  cochange: active\n");
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

describe("co-change by recency", () => {
  const DAY = 86_400;
  const NOW = 1_800_000_000;
  const at = (hash: string, daysAgo: number, ...files: readonly string[]): Commit => ({
    hash,
    files,
    time: NOW - daysAgo * DAY,
  });

  it("an old pair with no recent co-change stops warning, a recent one still warns", () => {
    const pair = (daysAgo: number) =>
      [1, 2, 3, 4, 5].map((index) => at(`p${String(index)}`, daysAgo + index, "src/a.ts", "src/b.ts"));
    const today = at("n1", 0, "src/c.ts", "src/d.ts");
    assert.deepEqual(missingPartners([today, ...pair(400)], ["src/a.ts"]), []);
    const recent = missingPartners([today, ...pair(10)], ["src/a.ts"]);
    const top = recent[0];
    assert.ok(top);
    assert.equal(top.partner, "src/b.ts");
    assert.ok(top.recentSupport > 4);
    const longMemory = { ...DEFAULT_OPTIONS, halfLifeDays: 3650 };
    assert.equal(missingPartners([today, ...pair(400)], ["src/a.ts"], longMemory)[0]?.partner, "src/b.ts");
  });

  it("adding one commit reads only that commit and keeps the cached history", () => {
    const repo = coupled();
    const paths = fmPaths(repo.root);
    const runtime = repoRuntime();
    const base = gitAt(runtime, repo.root);
    const logs: (readonly string[])[] = [];
    const git = {
      ...base,
      out: (args: readonly string[]) => {
        if (args[0] === "log") logs.push(args);
        return base.out(args);
      },
    };
    const first = historyOf(runtime, paths, git);
    assert.equal(first.length, 6);
    assert.ok(first.every((item) => typeof item.time === "number"));
    const old = repo.git("rev-parse", "HEAD").trim();
    repo.write("i18n/en.json", '{"k7": "v"}\n');
    repo.write("src/catalog.ts", "export const keys = [7];\n");
    repo.commit("add key 7");
    const head = repo.git("rev-parse", "HEAD").trim();
    const second = historyOf(runtime, paths, git);
    assert.equal(logs.length, 2);
    assert.equal(
      logs[0]?.some((arg) => arg.includes("..")),
      false,
    );
    assert.equal(logs[1]?.at(-1), `${old}..${head}`);
    assert.deepEqual(
      second.map((item) => item.hash),
      [head, ...first.map((item) => item.hash)],
    );
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
