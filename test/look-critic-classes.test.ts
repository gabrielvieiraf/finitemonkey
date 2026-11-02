import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import { type Critic, runCritic } from "../src/look/critic.js";
import { readCriticLedger } from "../src/look/critic-ledger.js";
import { shownCritiques } from "../src/look/critic-show.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const critic: Critic = {
  critique: () =>
    Promise.resolve([
      { heuristic: "N8-minimal", region: { x: 0, y: 0, w: 100, h: 40 }, text: "Two primary buttons compete." },
      { heuristic: "N1-status", region: { x: 0, y: 50, w: 100, h: 40 }, text: "No feedback after saving." },
    ]),
  rank: () => Promise.resolve("a"),
};

const INPUT = { route: "/", viewport: 390, screenshot: "x.png", contract: [], tokens: [] };
const CONFIG = "ui:\n  critic:\n    show_threshold: 0.5\n    min_shown: 1\n";

const critiqued = async (config: string) => {
  const repo = makeRepo(config === "" ? {} : { ".finitemonkey/config.yml": config });
  repos.push(repo);
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  const file = await runCritic({ runtime, paths, tree: "t1", mode: "shadow", critic, inputs: [INPUT] });
  if (file === undefined) throw new Error("critic did not run");
  return { repo, runtime, paths, critiques: file.critiques };
};

describe("critic: classes earn their place by acceptance", () => {
  it("a class below the threshold stays hidden and logged, and shows once the person accepts enough of it", async () => {
    const { repo, runtime, paths, critiques } = await critiqued(CONFIG);
    assert.deepEqual(shownCritiques(runtime, paths, critiques), []);
    const log = repo.read(".finitemonkey/log.jsonl");
    assert.ok(log.includes('"ui_critic_hidden"') && log.includes('"heuristic":"N8-minimal"'), log);
    const minimal = critiques.find((item) => item.heuristic === "N8-minimal");
    if (minimal === undefined) throw new Error("no N8 critique");
    const agent = await cliJson(["look", "opinion", "accept", minimal.id], {
      runtime,
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
    });
    assert.notEqual(agent.code, 0);
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    const accepted = await cliJson(["look", "opinion", "accept", minimal.id], { runtime, cwd: repo.root, stdin: tty });
    assert.equal(accepted.code, 0, accepted.stdout);
    assert.deepEqual(readCriticLedger(runtime, paths)["N8-minimal"]?.accepted, [minimal.id]);
    assert.deepEqual(
      shownCritiques(runtime, paths, critiques).map((item) => item.heuristic),
      ["N8-minimal"],
    );
  });

  it("without a configured threshold every class shows, as before", async () => {
    const { runtime, paths, critiques } = await critiqued("");
    assert.equal(shownCritiques(runtime, paths, critiques).length, 2);
  });

  it("an unknown opinion id is refused", async () => {
    const { repo, runtime } = await critiqued(CONFIG);
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    const run = await cliJson(["look", "opinion", "accept", "nope"], { runtime, cwd: repo.root, stdin: tty });
    assert.notEqual(run.code, 0);
  });
});
