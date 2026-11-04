import assert from "node:assert/strict";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import { run } from "../src/core/run.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { BYPASS_PROBE_FILE, readBypassProbe } from "../src/doctor/bypass-probe.js";
import { BYPASS_RUN_DIR, INSTRUCTIONS_CAPTURE_FILE } from "../src/doctor/bypass-run.js";
import { PROBE_EVENTS_FILE, PROBE_ID_ENV } from "../src/doctor/probe.js";
import { DENIED_FILE } from "../src/guards/bypass/ledger.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { execResult, fakeRuntime, found, TEST_VERSION } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const PATHS = fmPaths(ROOT);
const NOW = "2026-10-26T12:00:00.000Z";
const VERSION = "2.1.300";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const world = () => {
  const fs = memoryFs({}, [at(".git"), at(".finitemonkey"), at(".finitemonkey/cache")], NOW);
  const calls: ExecRequest[] = [];
  const runtime = fakeRuntime({
    fs,
    tools: { claude: found(`${VERSION} (Claude Code)`) },
    git: () => ({ found: true, ok: true, stdout: "" }),
    exec: (request) => {
      calls.push(request);
      const work = fmPaths(request.cwd);
      const id = request.env?.[PROBE_ID_ENV] ?? "";
      const call = { id: "t1", tool: "Write", summary: "probe" };
      fs.writeText(work.cache(DENIED_FILE), JSON.stringify({ schemaVersion: 1, calls: [call] }));
      fs.writeText(toAbsolutePath(join(work.root, ".finitemonkey", "bypasses.jsonl")), `${JSON.stringify(call)}\n`);
      fs.writeText(toAbsolutePath(join(work.root, BYPASS_PROBE_FILE)), "probe");
      const loaded = { session_id: "s1", hook_event_name: "InstructionsLoaded", file_path: "/x/CLAUDE.md" };
      fs.writeText(
        work.cache(PROBE_EVENTS_FILE),
        `${JSON.stringify({ id, event: "InstructionsLoaded", at: NOW, payload: loaded })}\n`,
      );
      return execResult(0, "{}");
    },
  });
  return { runtime, calls };
};

const doctor = async (argv: readonly string[], env: Readonly<Record<string, string>> = {}) => {
  const { runtime, calls } = world();
  const out: string[] = [];
  const err: string[] = [];
  const code = await run({
    argv,
    env,
    cwd: ROOT,
    platform: "linux",
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
      stdin: tty(),
    },
    version: TEST_VERSION,
    runtime,
  });
  return { code, calls, runtime, stdout: out.join(""), stderr: err.join("") };
};

const claudeCalls = (calls: readonly ExecRequest[]): readonly ExecRequest[] =>
  calls.filter((call) => call.command === "claude");

describe("finitemonkey doctor --probe bypass", () => {
  it("never runs from the agent", async () => {
    const result = await doctor(["doctor", "--probe", "bypass", "--yes"], { CLAUDECODE: "1" });
    assert.equal(result.code, 4);
    assert.deepEqual(claudeCalls(result.calls), []);
    assert.match(result.stdout + result.stderr, /Only the person can run the bypass probe/);
  });

  it("without --yes it prints what it costs and runs nothing", async () => {
    const result = await doctor(["doctor", "--probe", "bypass"]);
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(claudeCalls(result.calls), []);
    assert.match(result.stdout, /costs a few cents of model use/);
    assert.match(result.stdout, /Nothing was run/);
    assert.match(result.stdout, /not confirmed/);
  });

  it("with --yes it prints the cost first, runs one session and shows the cached outcome", async () => {
    const result = await doctor(["doctor", "--probe", "bypass", "--yes"]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /costs a few cents of model use/);
    const [call, ...more] = claudeCalls(result.calls);
    assert.ok(call !== undefined);
    assert.deepEqual(more, []);
    assert.ok(call.args.includes("--max-turns") && call.args.includes("4"));
    assert.deepEqual(call.unset, ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]);
    assert.equal(readBypassProbe(result.runtime, PATHS, VERSION)?.outcome, "fired");
    const capture = result.runtime.readText(PATHS.cache(INSTRUCTIONS_CAPTURE_FILE));
    assert.ok(capture.ok && capture.value.includes("InstructionsLoaded"));
    assert.equal(result.runtime.stat(PATHS.cache(BYPASS_RUN_DIR)), undefined);
    assert.match(result.stdout, /Claude Code 2\.1\.300: fired; 1 InstructionsLoaded event captured/);
    assert.match(result.stdout, /was followed by PostToolUse and recorded as a bypass/);
  });

  it("rejects an unknown probe name", async () => {
    const result = await doctor(["doctor", "--probe", "other"]);
    assert.equal(result.code, 2);
    assert.deepEqual(claudeCalls(result.calls), []);
  });
});
