import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { gitAt, treeHash } from "../src/gate/git.js";
import { recordReview } from "../src/gate/review.js";
import { runGate } from "../src/gate/run.js";
import { computeSize, DEFAULT_SIZE_CONFIG, sizeConfig, sizeVerdict } from "../src/gate/size.js";
import { parseConfigYaml } from "../src/git/project-config.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import type { TaskSize } from "../src/task/types.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const fresh = (size: TaskSize, config = ""): Repo => {
  const repo = makeRepo({
    "src/a.js": "export const a = 1;\n",
    "test/a.test.js": PASSING_TEST,
    ...(config === "" ? {} : { ".finitemonkey/config.yml": config }),
  });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "change a",
    size,
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

const touch = (repo: Repo, count: number, dir = "src"): void => {
  for (let index = 0; index < count; index += 1)
    repo.write(`${dir}/f${String(index)}.js`, `export const f = ${String(index)};\n`);
};

const report = (repo: Repo) => {
  const run = runGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 60_000,
    fast: false,
  });
  if (run.kind !== "done") throw new Error(`gate did not run: ${JSON.stringify(run)}`);
  return run.report;
};

const ids = (repo: Repo): readonly string[] => report(repo).items.map((item) => item.id);

describe("task size from the diff", () => {
  it("computes S, M and L from files, lines and sensitive paths", () => {
    const small = computeSize({ files: ["src/a.ts"], lines: 3 }, DEFAULT_SIZE_CONFIG);
    assert.equal(small.computed, "S");
    assert.equal(computeSize({ files: ["a", "b", "c", "d", "e"], lines: 5 }, DEFAULT_SIZE_CONFIG).computed, "M");
    assert.equal(computeSize({ files: ["a"], lines: 600 }, DEFAULT_SIZE_CONFIG).computed, "L");
    const pay = computeSize({ files: ["src/payments/charge.ts"], lines: 1 }, DEFAULT_SIZE_CONFIG);
    assert.equal(pay.computed, "M");
    assert.deepEqual(pay.sensitive, ["src/payments/charge.ts"]);
    assert.equal(computeSize({ files: ["db/migrations/001.sql"], lines: 1 }, DEFAULT_SIZE_CONFIG).computed, "M");
  });

  it("never lowers the declared size", () => {
    const verdict = sizeVerdict("L", { files: ["a"], lines: 1 }, DEFAULT_SIZE_CONFIG);
    assert.equal(verdict.computed, "S");
    assert.equal(verdict.effective, "L");
  });

  it("reads thresholds and sensitive paths from config.yml", () => {
    const config = sizeConfig(
      parseConfigYaml(
        [
          "size:",
          "  m:",
          "    files: 2",
          "    lines: 10",
          "  l:",
          "    files: 3",
          "  sensitive:",
          '    - "vendor/**"',
        ].join("\n"),
      ),
    );
    assert.deepEqual(config.m, { files: 2, lines: 10 });
    assert.deepEqual(config.l, { files: 3, lines: DEFAULT_SIZE_CONFIG.l.lines });
    assert.deepEqual(config.sensitive, ["vendor/**"]);
    assert.equal(computeSize({ files: ["a", "b"], lines: 1 }, config).computed, "M");
    assert.equal(computeSize({ files: ["vendor/x.js"], lines: 1 }, config).computed, "M");
    assert.equal(computeSize({ files: ["src/payments/x.js"], lines: 1 }, config).computed, "S");
  });

  it("a small S task keeps the S contract", () => {
    const repo = fresh("S");
    repo.write("src/a.js", "export const a = 2;\n");
    assert.ok(!ids(repo).includes("size-review"));
  });

  it("an S task that crosses to M gains the reviewer requirement", () => {
    const repo = fresh("S");
    touch(repo, 6);
    const result = report(repo);
    const review = result.items.find((item) => item.id === "size-review");
    assert.equal(review?.status, "failed");
    assert.equal(result.verdict, "failed");
    assert.ok(review.notes.some((entry) => entry.key === "gate.size.grew" && entry.params["effective"] === "M"));
  });

  it("touching a payment path upgrades the task to M", () => {
    const repo = fresh("S");
    repo.write("src/payments/charge.js", "export const charge = 1;\n");
    const review = report(repo).items.find((item) => item.id === "size-review");
    assert.ok(review?.notes.some((entry) => entry.key === "gate.size.sensitive"));
  });

  it("a review of the current tree satisfies the requirement", () => {
    const repo = fresh("S");
    touch(repo, 6);
    const tree = treeHash(gitAt(repoRuntime(), repo.root));
    assert.ok(tree !== undefined);
    recordReview(repoRuntime(), fmPaths(repo.root), tree, "finitemonkey:reviewer", "approve");
    assert.equal(report(repo).items.find((item) => item.id === "size-review")?.status, "passed");
    repo.write("src/f0.js", "export const f = 99;\n");
    assert.equal(report(repo).items.find((item) => item.id === "size-review")?.status, "failed");
  });

  it("an S task never gains plan or decision requirements, even past L", () => {
    const repo = fresh("S");
    touch(repo, 25);
    const found = ids(repo);
    assert.ok(found.includes("size-review"));
    assert.ok(!found.includes("size-inventory"));
    assert.ok(!found.includes("size-decision"));
  });

  it("an M task that grows to L gains inventory and decision", () => {
    const repo = fresh("M");
    touch(repo, 25);
    const found = ids(repo);
    assert.ok(found.includes("size-review"));
    assert.ok(found.includes("size-inventory"));
    assert.ok(found.includes("size-decision"));
  });

  it("thresholds from config.yml change when the upgrade happens", () => {
    const repo = fresh("S", ["size:", "  m:", "    files: 50", "    lines: 5000", "  sensitive: []", ""].join("\n"));
    touch(repo, 6);
    assert.ok(!ids(repo).includes("size-review"));
  });

  const reviewerStops = async (repo: Repo, verdict: string): Promise<void> => {
    const runtime = repoRuntime();
    await runHook("SubagentStop", {
      stdin: stdinFrom(
        JSON.stringify({
          session_id: "s1",
          cwd: repo.root,
          hook_event_name: "SubagentStop",
          agent_type: "finitemonkey:reviewer",
          last_assistant_message: `Findings above.\n\n\`\`\`json\n{"verdict": "${verdict}", "findings": []}\n\`\`\`\n`,
        }),
      ),
      deadlineMs: 60_000,
      handlers: DEFAULT_HANDLERS,
      cwd: repo.root,
      t: createTranslator("en"),
      startTimer: runtime.startTimer,
      runtime,
      env: {},
    });
  };

  it("a reviewer subagent finishing records a review of the tree with its verdict", async () => {
    const repo = fresh("S");
    touch(repo, 6);
    await reviewerStops(repo, "request-changes");
    assert.equal(report(repo).items.find((item) => item.id === "size-review")?.status, "failed");
    await reviewerStops(repo, "approve");
    assert.equal(report(repo).items.find((item) => item.id === "size-review")?.status, "passed");
  });
});
