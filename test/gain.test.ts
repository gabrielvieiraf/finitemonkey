import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { ExitCode } from "../src/exit-codes.js";
import { gainReport } from "../src/gain/gain.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { keySeed, signedTest } from "./signed.js";
import { cliJson, fakeRuntime, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const NOW = "2026-10-26T12:00:00.000Z";
const hoursAgo = (hours: number): string => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

const log = [
  { at: hoursAgo(10), event: "guard_block", hook: "PreToolUse" },
  { at: hoursAgo(30), event: "guard_block", hook: "PreToolUse" },
  { at: hoursAgo(50), event: "guard_block", hook: "Stop" },
  { at: hoursAgo(5), event: "person.allow", guard: "tests", reason: "flaky upstream" },
  { at: hoursAgo(5), event: "person.approve", check: "visual", reason: "" },
  { at: hoursAgo(4), event: "guard_false_positive", guard: "prose" },
  { at: hoursAgo(24 * 9), event: "guard_block", hook: "PreToolUse" },
  { at: hoursAgo(24 * 9), event: "guard_block", hook: "PreToolUse" },
  { at: hoursAgo(24 * 9), event: "guard_block", hook: "PreToolUse" },
  { at: hoursAgo(24 * 9), event: "guard_block", hook: "PreToolUse" },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

const gate = (
  hours: number,
  status: "passed" | "failed" | "unverified",
  durationMs: number,
  treeHash = "abc",
): string =>
  signedTest({
    schema: "finitemonkey/evidence@1",
    task: "implicit",
    check: "*gate*",
    kind: "gate",
    status,
    treeHash,
    at: hoursAgo(hours),
    notes: [],
    durationMs,
  });

const ledger = [gate(8, "passed", 90_000, "def"), gate(20, "failed", 60_000), gate(26, "unverified", 30_000)].join(
  "\n",
);

const fixture = () =>
  memoryFs(
    {
      [at(".finitemonkey/log.jsonl")]: `${log}\n`,
      [at(".finitemonkey/evidence/implicit.jsonl")]: `${ledger}\n`,
      ...keySeed(),
    },
    [at(".git")],
    NOW,
  );

describe("finitemonkey gain", () => {
  it("derives every number from the log and the evidence ledgers", () => {
    const report = gainReport(fakeRuntime({ fs: fixture() }), fmPaths(ROOT), 7);
    assert.deepEqual(report.current, {
      blocks: 3,
      saves: 1,
      releases: 1,
      falsePositives: 1,
      overridesWithReason: 1,
      overridesWithoutReason: 1,
      gateRuns: 3,
      gateFailed: 1,
      gateUnverified: 1,
      gateMs: 180_000,
    });
    assert.equal(report.previous.blocks, 4);
  });

  it("a pass on the same tree as the failure is not a save", () => {
    const sameTree = [gate(8, "passed", 90_000), gate(20, "failed", 60_000)].join("\n");
    const fs = memoryFs(
      { [at(".finitemonkey/log.jsonl")]: `${log}\n`, [at(".finitemonkey/evidence/implicit.jsonl")]: `${sameTree}\n` },
      [at(".git")],
      NOW,
    );
    assert.equal(gainReport(fakeRuntime({ fs }), fmPaths(ROOT), 7).current.saves, 0);
  });

  it("shows false alarms and gate failures next to the saves, and says when a number went down", async () => {
    const result = await cliJson(["gain", "--days", "7"], { cwd: ROOT, runtime: fakeRuntime({ fs: fixture() }) });
    assert.equal(result.code, ExitCode.Ok);
    const human = await import("./support.js").then(({ cli }) =>
      cli(["gain", "--days", "7"], { cwd: ROOT, runtime: fakeRuntime({ fs: fixture() }) }),
    );
    const text = human.stdout;
    assert.match(text, /3 blocks by the guards \(down 1 on the window before\)/);
    assert.match(text, /1 block after which the same check went from failed to passed/);
    assert.match(text, /1 false alarm recorded/);
    assert.match(text, /1 override typed by the person with a reason/);
    assert.match(text, /1 override without a reason/);
    assert.match(text, /1 gate run failed/);
    assert.match(text, /1 gate run ended not verified/);
    assert.match(text, /3 minutes spent in the gate/);
  });

  it("--json follows the envelope with the gain@1 data", async () => {
    const result = await cliJson(["gain"], { cwd: ROOT, runtime: fakeRuntime({ fs: fixture() }) });
    assert.equal(field(result.body, "schemaVersion"), 1);
    assert.equal(field(result.body, "command"), "gain");
    assert.equal(field(result.body, "data", "schema"), "finitemonkey/gain@1");
    assert.equal(field(result.body, "data", "days"), 30);
  });

  it("rejects a window outside 1-365 days", async () => {
    const result = await cliJson(["gain", "--days", "0"], { cwd: ROOT, runtime: fakeRuntime({ fs: fixture() }) });
    assert.equal(result.code, ExitCode.Usage);
  });
});
