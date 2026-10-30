import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { runChain, subcontracts } from "../src/autonomy/chain.js";
import { readMarker } from "../src/autonomy/hold.js";
import { localHorizon, planRun } from "../src/autonomy/plan.js";
import { DEFAULT_POLICY } from "../src/policy/policy.js";
import { fmPaths } from "../src/task/paths.js";
import type { TaskContract } from "../src/task/types.js";
import { contextOf, denied, fireHook } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { signedLine } from "./signed.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const checks = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) => `  - id: c${String(index + 1)}\n    check: command\n    run: npm test\n`,
  ).join("");

const contract = (id: string, size: string, count: number): string =>
  `id: ${id}\ngoal: ${id}\nsize: ${size}\nscope:\n  paths: [src/app/]\nacceptance:\n${checks(count)}`;

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

const history = (count: number): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index): [string, string][] => {
      const id = `past${String(index + 1)}`;
      const start = Date.UTC(2026, 9, index + 1, 9);
      return [
        [`.finitemonkey/tasks/${id}.yml`, contract(id, "S", 1)],
        [
          `.finitemonkey/evidence/${id}.jsonl`,
          `${line(id, "c1", "passed", start)}\n${line(id, "*gate*", "passed", start + 3_600_000)}\n`,
        ],
      ];
    }).flat(),
  );

const setup = (files: Readonly<Record<string, string>> = {}): Repo => {
  const done = Array.from({ length: 5 }, (_, index) => `past${String(index + 1)}`);
  const repo = makeRepo({
    ...history(5),
    ".finitemonkey/tasks/big.yml": contract("big", "L", 3),
    ".finitemonkey/tasks/mid.yml": contract("mid", "M", 4),
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, done }),
    ...files,
  });
  repos.push(repo);
  return repo;
};

const MID: TaskContract = {
  id: "mid",
  goal: "mid",
  size: "M",
  scope: { paths: ["src/app/"], testsProtected: true },
  acceptance: [1, 2, 3, 4].map((index) => ({ id: `c${String(index)}`, kind: "command", run: "npm test" })),
  decisionsNeeded: [],
  implicit: false,
};

describe("unattended runs sized by the local p80 horizon", () => {
  it("refuses a contract larger than the local horizon that cannot be split finer, and splits one that can", async () => {
    const repo = setup();
    const big = await cli(["run", "--unattended", "big"], { cwd: repo.root, runtime: repoRuntime() });
    assert.notEqual(big.code, 0);
    assert.match(big.stdout + big.stderr, /8 parts.*3 acceptance checks/s);
    const mid = await cli(["run", "--unattended", "mid"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(mid.code, 0, mid.stdout + mid.stderr);
    assert.match(mid.stdout, /horizon 60 min \(local\)/);
    assert.match(mid.stdout, /part 1: c1, c2/);
    assert.match(mid.stdout, /part 2: c3, c4/);
    assert.match(mid.stdout, /not started/);
  });

  it("falls back to the published horizon with a margin when the local history is short", () => {
    const horizon = localHorizon([{ wallMs: 1000, ok: true }], DEFAULT_POLICY.autonomy);
    assert.deepEqual(horizon, { ms: 60 * 60_000 * 0.5, source: "published", tasks: 1 });
    const plan = planRun(MID, horizon, { ms: 120 * 60_000, source: "size" });
    assert.equal(plan.kind, "split");
  });

  it("a failing subcontract stops the chain and the report says so", () => {
    const repo = setup();
    const paths = fmPaths(repo.root);
    const parts = subcontracts(MID, [MID.acceptance.slice(0, 2), MID.acceptance.slice(2)]);
    const seen: string[] = [];
    const report = runChain(
      repoRuntime(),
      paths,
      {
        agent: (task) => {
          seen.push(`${task.id}:${readMarker(repoRuntime(), paths) === undefined ? "free" : "held"}`);
          return true;
        },
        gate: () => "failed",
      },
      DEFAULT_POLICY.autonomy,
      MID,
      parts,
    );
    assert.deepEqual(seen, ["mid-u1:held"]);
    assert.deepEqual(
      report.items.map((item) => [item.task, item.status]),
      [
        ["mid-u1", "invalidated"],
        ["mid-u2", "unproven"],
      ],
    );
    assert.equal(report.stoppedBy, "gate_failed");
    assert.equal(readMarker(repoRuntime(), paths), undefined);
    assert.match(repo.read(`.finitemonkey/reports/unattended-${report.run}.json`), /gate_failed/);
  });

  it("an edit to a fixed criterion during the run invalidates the part", () => {
    const repo = setup();
    const paths = fmPaths(repo.root);
    const parts = subcontracts(MID, [MID.acceptance.slice(0, 2), MID.acceptance.slice(2)]);
    const report = runChain(
      repoRuntime(),
      paths,
      {
        agent: (task) => {
          repo.write(`.finitemonkey/tasks/${task.id}.yml`, contract(task.id, "S", 1));
          return true;
        },
        gate: () => "passed",
      },
      DEFAULT_POLICY.autonomy,
      MID,
      parts,
    );
    assert.equal(report.items[0]?.why, "criteria_changed");
  });

  it("holds destructive and production actions while a run is on, and lists them in the report", async () => {
    const repo = setup({
      ".finitemonkey/cache/unattended.json": JSON.stringify({ run: "u1", until: "2999-01-01T00:00:00.000Z" }),
    });
    for (const command of ["git push origin wip", "rm -rf build", "psql postgres://db.example.com", "npm publish"]) {
      const outcome = await fireHook(repo, "PreToolUse", { tool_name: "Bash", tool_input: { command } });
      assert.equal(denied(outcome), true, command);
      assert.match(contextOf(outcome), /unattended/, command);
    }
    const ok = await fireHook(repo, "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } });
    assert.equal(denied(ok), false);
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"event":"unattended_hold".*"reason":"git push"/);
  });
});
