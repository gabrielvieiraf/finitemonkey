import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { parseTranscript } from "../src/history/transcript.js";
import { localizationOf } from "../src/knowledge/turn-measures.js";
import { armOf } from "../src/policy/experiment.js";
import { fireHook } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SOURCE = "claude-md";

const taskOn = (arm: "active" | "off", skip: readonly string[] = []): string => {
  for (let index = 0; index < 500; index += 1) {
    const name = `task${String(index)}`;
    if (!skip.includes(name) && armOf(name, SOURCE) === arm) return name;
  }
  throw new Error("no task for arm");
};

const OFF = taskOn("off");
const ACTIVE = taskOn("active");

const armLine = (task: string): string =>
  JSON.stringify({
    at: "2026-10-01T09:00:00.000Z",
    event: "experiment_arm",
    feature: SOURCE,
    task,
    arm: armOf(task, SOURCE),
  });

const costLine = (task: string, minute: number, input: number): string =>
  JSON.stringify({
    model: "claude-test",
    agent: null,
    input,
    output: 100,
    cacheRead: 0,
    cacheWrite: 0,
    at: new Date(Date.UTC(2026, 9, 1, 10, minute)).toISOString(),
    task,
    arms: [`${SOURCE}=${armOf(task, SOURCE)}`],
    usd: 0.01,
  });

const toolUse = (id: string, name: string, file: string): string =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input: { file_path: file } }] },
  });

const session = (root: string, read: string, edited: string): string =>
  [
    JSON.stringify({ type: "user", message: { content: "fix the coupon total" } }),
    toolUse("u1", "Read", join(root, read)),
    toolUse("u2", "Grep", join(root, "src")),
    toolUse("u3", "Edit", join(root, edited)),
    "",
  ].join("\n");

const project = (active: string, extra: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({
    "src/coupon.ts": "export const total = 1;\n",
    ".finitemonkey/policy.yml": `experiments:\n  ${SOURCE}: random\n`,
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active, done: [] }),
    ...extra,
  });
  repos.push(repo);
  return repo;
};

const claudeReport = async (repo: Repo) => {
  const run = await cliJson(["experiments", "report"], { cwd: repo.root, runtime: repoRuntime() });
  assert.equal(run.code, 0, run.stdout);
  const sources = field(run.body, "data", "sources");
  const list: readonly unknown[] = Array.isArray(sources) ? sources : [];
  return list.find((item) => field(item, "source") === SOURCE);
};

describe("instruction files and prompt sections as arms", () => {
  it("tells the mod to withhold CLAUDE.md only for a task in its off arm", async () => {
    const off = await cliJson(["mod", "state"], { cwd: project(OFF).root, runtime: repoRuntime() });
    assert.deepEqual(field(off.body, "data", "withhold"), [SOURCE]);
    const on = await cliJson(["mod", "state"], { cwd: project(ACTIVE).root, runtime: repoRuntime() });
    assert.deepEqual(field(on.body, "data", "withhold"), []);
  });

  it("finds whether the first file read was the next one edited", () => {
    const root = toAbsolutePath("/work");
    const hit = localizationOf(parseTranscript(session(root, "src/coupon.ts", "src/coupon.ts")), root);
    assert.deepEqual(hit, { read: "src/coupon.ts", edited: "src/coupon.ts", localized: true });
    const miss = localizationOf(parseTranscript(session(root, "README.md", "src/coupon.ts")), root);
    assert.equal(miss?.localized, false);
  });

  it("reports tokens per turn and localization per arm from a fixture session", async () => {
    const repo = project(OFF, {
      ".finitemonkey/log.jsonl": `${[armLine(OFF), armLine(ACTIVE)].join("\n")}\n`,
      ".finitemonkey/cost.jsonl": `${[costLine(OFF, 1, 900), costLine(OFF, 2, 1900), costLine(ACTIVE, 3, 4900)].join("\n")}\n`,
    });
    repo.write("session.jsonl", session(repo.root, "src/coupon.ts", "src/coupon.ts"));
    await fireHook(repo, "Stop", { transcript_path: join(repo.root, "session.jsonl") }, repoRuntime({ spawned: [] }));
    await fireHook(repo, "Stop", { transcript_path: join(repo.root, "session.jsonl") }, repoRuntime({ spawned: [] }));
    assert.equal(repo.read(".finitemonkey/log.jsonl").split('"experiment_localization"').length - 1, 1);
    const report = await claudeReport(repo);
    assert.equal(field(report, "off", "tokensPerTurn"), 1500);
    assert.equal(field(report, "active", "tokensPerTurn"), 5000);
    assert.equal(field(report, "off", "localization"), 1);
    assert.equal(field(report, "active", "localization"), null);
    const text = await cli(["experiments", "report"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(text.stdout, /claude-md: 5000\.00 tokens per turn with it, 1500\.00 without/);
  });

  it("marks the arm unsupported when the mod finds no section to withhold, and supported once it drops one", async () => {
    const repo = project(OFF, { ".finitemonkey/log.jsonl": `${armLine(OFF)}\n` });
    const missing = await cliJson(["mod", "drop", "--source", SOURCE], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(missing.code, 0, missing.stdout);
    assert.equal(field(await claudeReport(repo), "support"), "unsupported");
    const text = await cli(["experiments", "report"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(text.stdout, /claude-md: the mod found no such section in the prompt/);
    await cliJson(["mod", "drop", "--source", SOURCE, "--section", "claude-md:project"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(field(await claudeReport(repo), "support"), "supported");
    assert.match(
      repo.read(".finitemonkey/log.jsonl"),
      new RegExp(`"event":"experiment_drop","feature":"claude-md","task":"${OFF}","section":"claude-md:project"`),
    );
    const bad = await cliJson(["mod", "drop", "--source", "readme"], { cwd: repo.root, runtime: repoRuntime() });
    assert.notEqual(bad.code, 0);
  });
});
