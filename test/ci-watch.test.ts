import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyLog } from "../src/ci/watch/classify.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { cli, cliJson, execResult, fakeRuntime, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const at = (path: string): string => toAbsolutePath(path, ROOT);
const LINT_LOG = "check\tRun npm run lint\n/src/a.ts\n  3:1  error  'x' is defined but never used  eslint\n";
const AUTH_LOG = "deploy\tRun gh api\nHttpError: Resource not accessible by integration\n";

interface Script {
  sha: string;
  buckets: readonly string[];
  log: string;
}

const fakeGh = (script: Script, calls: ExecRequest[]) => (request: ExecRequest) => {
  if (request.command !== "gh") return undefined;
  calls.push(request);
  const args = request.args.join(" ");
  if (args.startsWith("pr view"))
    return execResult(
      0,
      JSON.stringify({ number: 12, headRefOid: script.sha, url: "https://github.com/acme/app/pull/12" }),
    );
  if (args.startsWith("pr checks")) {
    const checks = script.buckets.map((bucket, index) => ({
      name: `check-${String(index)}`,
      bucket,
      link: "https://github.com/acme/app/actions/runs/99/job/1",
    }));
    return execResult(script.buckets.includes("fail") ? 1 : 0, JSON.stringify(checks));
  }
  if (args.startsWith("run view 99 --log-failed")) return execResult(0, script.log);
  return execResult(1, "", "unexpected");
};

const setup = (script: Script, files: Readonly<Record<string, string>> = {}) => {
  const calls: ExecRequest[] = [];
  const runtime = fakeRuntime({
    exec: fakeGh(script, calls),
    timer: "fires-now",
    files: Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
  });
  return {
    calls,
    runtime,
    watch: (argv: readonly string[] = []) => cliJson(["ci-watch", ...argv], { runtime, cwd: ROOT }),
  };
};

describe("ci-watch", () => {
  it("stops at the attempt ceiling after three pushed fixes that stay red", async () => {
    const script: Script = { sha: "a1", buckets: ["pass", "fail"], log: LINT_LOG };
    const { watch } = setup(script);
    const outcomes: string[] = [];
    for (const sha of ["a1", "a1", "a2", "a3", "a4"]) {
      script.sha = sha;
      const run = await watch();
      outcomes.push(
        `${String(run.code)}:${String(field(run.body, "data", "outcome"))}:${String(field(run.body, "data", "attempt"))}`,
      );
    }
    assert.deepEqual(outcomes, ["1:fix:0", "1:fix:0", "1:fix:1", "1:fix:2", "4:attempts:3"]);
  });

  it("asks the person at once when the failure is not the agent's to fix", async () => {
    const { watch } = setup({ sha: "b1", buckets: ["fail"], log: AUTH_LOG });
    const run = await watch();
    assert.equal(run.code, 4);
    assert.equal(field(run.body, "data", "classification"), "asks");
  });

  it("stops at the cost ceiling", async () => {
    const spend = JSON.stringify({
      messages: { m1: { at: "2026-10-25T12:00:00.000Z", model: "claude", usd: 6, tokens: 10 } },
    });
    const { watch } = setup({ sha: "c1", buckets: ["fail"], log: LINT_LOG }, { ".finitemonkey/spend.json": spend });
    const run = await watch(["--max-usd", "5"]);
    assert.equal(run.code, 4);
    assert.equal(field(run.body, "data", "outcome"), "cost");
  });

  it("never polls past the call ceiling", async () => {
    const { watch, calls } = setup({ sha: "d1", buckets: ["pending"], log: "" });
    const run = await watch(["--max-calls", "5"]);
    assert.equal(run.code, 1);
    assert.equal(field(run.body, "data", "outcome"), "calls");
    assert.equal(calls.length, 5);
  });

  it("records the CI state as evidence with the commit", async () => {
    const { watch, runtime } = setup({ sha: "e1f2", buckets: ["pass", "skipping"], log: "" });
    const run = await watch();
    assert.equal(run.code, 0);
    const log = runtime.readText(toAbsolutePath(at(".finitemonkey/ci-watch/pr-12.jsonl")));
    assert.ok(log.ok);
    const line = JSON.parse(log.value.trim()) as unknown;
    assert.equal(field(line, "sha"), "e1f2");
    assert.equal(field(line, "outcome"), "green");
    assert.match(log.value, /"bucket":"pass"/);
  });

  it("follows the ci-watch flag in policy.yml", async () => {
    const { calls, runtime } = setup(
      { sha: "f1", buckets: ["fail"], log: LINT_LOG },
      {
        ".finitemonkey/policy.yml": "guards:\n  ci-watch: off\n",
      },
    );
    const run = await cli(["ci-watch"], { runtime, cwd: ROOT });
    assert.equal(run.code, 0);
    assert.equal(calls.length, 0);
  });

  it("classifies lint, type and test failures as fixable and credentials or runners as asks", () => {
    assert.equal(classifyLog("src/a.ts(3,1): error TS2322: Type 'x'"), "fixes-itself");
    assert.equal(classifyLog("AssertionError [ERR_ASSERTION]: expected"), "fixes-itself");
    assert.equal(classifyLog("The runner has received a shutdown signal"), "asks");
    assert.equal(classifyLog("Error: secret NPM_TOKEN is not set"), "asks");
    assert.equal(classifyLog("something nobody recognizes"), "asks");
  });
});
