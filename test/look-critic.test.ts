import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";

import { runGate } from "../src/gate/run.js";
import { type Critic, keepValid, rankPair, readPairs } from "../src/look/critic.js";
import { runLook } from "../src/look/run.js";
import { armOf } from "../src/policy/experiment.js";
import { fmPaths } from "../src/task/paths.js";
import { fixtureRepo, hasBrowser } from "./look-fixture.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

const fakeCritic = (): Critic & { readonly calls: () => number } => {
  let calls = 0;
  return {
    calls: () => calls,
    critique: () => {
      calls += 1;
      return Promise.resolve([
        { heuristic: "N8-minimal", region: { x: 0, y: 0, w: 100, h: 40 }, text: "Two primary buttons compete." },
        { heuristic: "taste", region: { x: 0, y: 0, w: 10, h: 10 }, text: "not on the checklist" },
        { heuristic: "N1-status", text: "no region" },
      ]);
    },
    rank: () => {
      calls += 1;
      return Promise.resolve("a");
    },
  };
};

describe("critic: advisory only", () => {
  it("each critique needs a region and a checklist id, or it is dropped", () => {
    const input = { route: "/", viewport: 390, screenshot: "x.png", contract: [], tokens: [] };
    const kept = keepValid(input, [
      { heuristic: "N8-minimal", region: { x: 0, y: 0, w: 100, h: 40 }, text: "ok" },
      { heuristic: "N8-minimal" },
      { heuristic: "vibes", region: { x: 0, y: 0, w: 1, h: 1 } },
    ]);
    assert.deepEqual(
      kept.map((item) => item.heuristic),
      ["N8-minimal"],
    );
  });

  it("pairwise rankings and the person's pick are stored side by side", async () => {
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    const pair = await rankPair(runtime, paths, fakeCritic(), {
      a: "a.png",
      b: "b.png",
      checklist: ["clear primary action"],
    });
    assert.equal(pair.critic, "a");
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    const agent = await cliJson(["look", "pair", "pick", pair.id, "b"], {
      runtime,
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(agent.code, 0);
    const picked = await cliJson(["look", "pair", "pick", pair.id, "b"], { runtime, cwd: repo.root, stdin: tty });
    assert.equal(picked.code, 0, picked.stdout);
    assert.deepEqual(
      readPairs(runtime, paths).map((item) => [item.critic, item.person]),
      [["a", "b"]],
    );
  });
});

const lookStatus = (repo: Repo) => {
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
  return JSON.stringify([item?.status, item?.notes]);
};

describe("critic: on the rendered screens", () => {
  it("is never called with the flag off, records its arm per task, and never changes the gate verdict", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const off =
      "guards:\n  a11y: off\n  keyboard: off\n  ui-states: off\n  ds-adherence: off\n  default-look: off\n  perf-budget: off\n";
    const repo = await fixtureRepo(
      { "/": "<main><h1>Shop</h1><button>Buy</button></main>" },
      { routes: ["/"], policy: `${off}  ui-critic: off\n` },
    );
    repos.push(repo);
    const critic = fakeCritic();
    const first = await runLook(repoRuntime(), repo.root, critic);
    assert.equal(first.kind, "done");
    assert.equal(critic.calls(), 0);
    const before = lookStatus(repo);
    repo.write(".finitemonkey/policy.yml", `${off}  ui-critic: shadow\nexperiments:\n  ui-critic: random\n`);
    await runLook(repoRuntime(), repo.root, critic);
    const arm = armOf("t1", "ui-critic");
    assert.equal(critic.calls() > 0, arm === "active");
    const log = repo.read(".finitemonkey/log.jsonl");
    assert.ok(log.includes('"ui_critic"') && log.includes(`"arm":"${arm}"`) && log.includes('"task":"t1"'));
    const dir = join(repo.root, ".finitemonkey", "look", first.summary.treeHash);
    assert.ok(existsSync(join(dir, "critique.json")));
    assert.ok(!repo.read(`.finitemonkey/look/${first.summary.treeHash}/summary.json`).includes("critique"));
    assert.equal(lookStatus(repo), before);
  });
});
