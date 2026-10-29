import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { PROBE_EVENTS_FILE, PROBE_ID_ENV, probeFindings, recordProbeEvent, runProbe } from "../src/doctor/probe.js";
import { recordReleasedByCap, writeGateStatus } from "../src/gate/hooks/status.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { cliJson, execResult, fakeRuntime, field, found, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const PATHS = fmPaths(ROOT);
const NOW = "2026-10-26T12:00:00.000Z";

const setup = (version: string, fired: readonly { event: string; agent?: string }[]) => {
  const fs = memoryFs({}, [at(".git"), at(".finitemonkey"), at(".finitemonkey/cache")], NOW);
  const calls: ExecRequest[] = [];
  const runtime = fakeRuntime({
    fs,
    tools: { claude: found(`${version} (Claude Code)`) },
    exec: (request) => {
      calls.push(request);
      const id = request.env?.[PROBE_ID_ENV] ?? "";
      for (const item of fired) {
        recordProbeEvent(runtime, PATHS, id, item.event, item.agent === undefined ? {} : { agent_id: item.agent });
      }
      return execResult(0, "{}");
    },
  });
  return { fs, runtime, calls };
};

const WITHOUT_SUBAGENT_HOOK = [{ event: "PreToolUse" }, { event: "SubagentStart" }, { event: "Stop" }];

describe("doctor --probe", () => {
  it("reports a missing PreToolUse inside a subagent", () => {
    const { runtime, calls } = setup("2.1.300", WITHOUT_SUBAGENT_HOOK);
    const result = runProbe(runtime, PATHS);
    assert.deepEqual(result?.missing, ["PreToolUse:subagent"]);
    assert.equal(calls[0]?.command, "claude");
    const [finding] = probeFindings(result);
    assert.ok(finding);
    assert.equal(finding.status, "fail");
    assert.equal(finding.params?.["list"], "PreToolUse:subagent");
  });

  it("passes when every hook fires, including inside the subagent", () => {
    const { runtime } = setup("2.1.300", [...WITHOUT_SUBAGENT_HOOK, { event: "PreToolUse", agent: "a1" }]);
    assert.deepEqual(runProbe(runtime, PATHS)?.missing, []);
  });

  it("caches the result per Claude Code version", () => {
    const first = setup("2.1.300", WITHOUT_SUBAGENT_HOOK);
    runProbe(first.runtime, PATHS);
    const again = runProbe(first.runtime, PATHS);
    assert.equal(first.calls.length, 1);
    assert.ok(again);
    assert.equal(again.cached, true);
    assert.deepEqual(again.missing, ["PreToolUse:subagent"]);
  });

  it("the doctor command runs it and fails on the missing hook", async () => {
    const { runtime } = setup("2.1.300", WITHOUT_SUBAGENT_HOOK);
    const result = await cliJson(["doctor", "--probe"], { cwd: ROOT, runtime });
    assert.deepEqual(field(result.body, "data", "probe", "missing"), ["PreToolUse:subagent"]);
  });

  it("hooks record the probe events, marking the ones inside a subagent", async () => {
    const { fs, runtime } = setup("2.1.300", []);
    const payload = JSON.stringify({ session_id: "s", cwd: ROOT, tool_name: "Read", agent_id: "a1", tool_input: {} });
    await runHook("PreToolUse", {
      stdin: stdinFrom(payload),
      deadlineMs: 5000,
      handlers: DEFAULT_HANDLERS,
      cwd: ROOT,
      t: createTranslator("en"),
      startTimer: runtime.startTimer,
      runtime,
      env: { [PROBE_ID_ENV]: "p1" },
    });
    assert.match(
      fs.read(at(`.finitemonkey/cache/${PROBE_EVENTS_FILE}`)) ?? "",
      /"id":"p1","event":"PreToolUse:subagent"/,
    );
  });
});

describe("a session released by the Stop cap", () => {
  it("blocks pr open until the gate passes", async () => {
    const { runtime } = setup("2.1.300", []);
    recordReleasedByCap(runtime, PATHS, "t1", "8 blocks without a tool call");
    const held = await cliJson(["pr", "open", "--dry-run"], { cwd: ROOT, runtime });
    assert.equal(field(held.body, "error", "code"), "gate_released_by_cap");
    writeGateStatus(runtime, PATHS, { status: "passed", task: "t1", detail: "" });
    const after = await cliJson(["pr", "open", "--dry-run"], { cwd: ROOT, runtime });
    assert.notEqual(field(after.body, "error", "code"), "gate_released_by_cap");
  });
});
