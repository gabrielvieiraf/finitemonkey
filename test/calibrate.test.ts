import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { CALIBRATE_INPUTS } from "../src/calibrate/inputs.js";
import { computeCalibration } from "../src/calibrate/refit.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const contract = (id: string): string =>
  `id: ${id}\ngoal: ${id}\nsize: S\nscope:\n  paths: [src/app/]\nacceptance:\n  - id: t\n    check: command\n    run: npm test\n`;

const line = (task: string, check: string, status: string, at: number): string =>
  signedLine(repoRuntime(), {
    schema: "finitemonkey/evidence@1",
    task,
    check,
    kind: check === "*gate*" ? "gate" : "command",
    status,
    treeHash: "t",
    at: new Date(at).toISOString(),
    notes: [],
  });

const finished = (task: string, day: number, bad: boolean): string => {
  const start = Date.UTC(2026, 9, day, 9);
  return `${[
    line(task, "t", "passed", start),
    line(task, "*gate*", "passed", start + 3_600_000),
    ...(bad ? [line(task, "*gate*", "failed", start + 7_200_000)] : []),
  ].join("\n")}\n`;
};

const event = (data: Readonly<Record<string, unknown>>): string =>
  JSON.stringify({ at: "2026-10-28T10:00:00.000Z", ...data });

const setup = (count: number, policy: string, log: readonly string[] = []): Repo => {
  const names = Array.from({ length: count }, (_, index) => `past${String(index + 1)}`);
  const files: Record<string, string> = {
    ".finitemonkey/tasks/now.yml": contract("now"),
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "now", done: names }),
    ".finitemonkey/policy.yml": policy,
    ".finitemonkey/log.jsonl": `${log.join("\n")}\n`,
  };
  names.forEach((name, index) => {
    files[`.finitemonkey/tasks/${name}.yml`] = contract(name);
    files[`.finitemonkey/evidence/${name}.jsonl`] = finished(name, index + 1, index % 2 === 0);
  });
  const repo = makeRepo(files);
  repos.push(repo);
  return repo;
};

const DIVERGED = event({ event: "divergence.outcome", task: "now", mode: "active", kind: "question" });

describe("calibrate: when to ask, from local labels", () => {
  it("below the label minimum the fixed rules decide", async () => {
    const repo = setup(4, policyWith({ calibrate: "active" }), [DIVERGED]);
    const run = await cliJson(["calibrate", "explain", "now"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(run.body, "data", "labels"), 4);
    assert.equal(field(run.body, "data", "decision", "by"), "rules");
    assert.equal(field(run.body, "data", "decision", "state"), "ask");
    const text = await cli(["calibrate", "explain", "now"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(text.stdout, /yellow/);
    assert.doesNotMatch(text.stdout, /0\.\d{3}/);
  });

  it("at the minimum a fitted model decides, from the same three inputs", async () => {
    const repo = setup(4, `${policyWith({ calibrate: "active" })}calibrate:\n  minLabels: 4\n`, [DIVERGED]);
    const run = await cliJson(["calibrate", "explain", "now"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(run.body, "data", "decision", "by"), "model");
    assert.deepEqual(field(run.body, "data", "inputs"), [...CALIBRATE_INPUTS]);
  });

  it("never reads the model's own confidence text", () => {
    const noise = [
      event({ event: "assistant_message", task: "now", text: "I am 99% confident this is correct" }),
      event({ event: "divergence.outcome", task: "now", kind: "agree", confidence: 0.99 }),
      event({ event: "claims.done", task: "now", confidence: "high" }),
    ];
    assert.equal(
      CALIBRATE_INPUTS.some((name) => /confiden/i.test(name)),
      false,
    );
    const plain = setup(4, policyWith({ calibrate: "active" }), [DIVERGED]);
    const noisy = setup(4, policyWith({ calibrate: "active" }), [DIVERGED, ...noise]);
    const left = computeCalibration(repoRuntime(), fmPaths(plain.root)).decisions["now"];
    const right = computeCalibration(repoRuntime(), fmPaths(noisy.root)).decisions["now"];
    assert.deepEqual(right, left);
  });

  it("refits at Stop in the background, never inside the hook", async () => {
    const repo = setup(4, policyWith({ calibrate: "active" }), [DIVERGED]);
    const spawned: string[][] = [];
    await fireHook(repo, "Stop", {}, repoRuntime({ spawned }));
    assert.deepEqual(
      spawned.filter((args) => args[0] === "calibrate"),
      [["calibrate", "refit"]],
    );
    assert.equal(repoRuntime().readText(fmPaths(repo.root).cache("calibration.json")).ok, false);
    await cli(["calibrate", "refit"], { cwd: repo.root, runtime: repoRuntime() });
    const shown = await fireHook(repo, "UserPromptSubmit", { prompt: "finitemonkey: trust now" });
    assert.match(contextOf(shown), /now: yellow/);
  });
});
