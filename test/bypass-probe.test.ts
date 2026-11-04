import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import {
  BYPASS_PROBE_FILE,
  bypassFacts,
  bypassFindings,
  capturedInstructions,
  checkBypassOrder,
  classifyBypass,
  readBypassProbe,
  writeBypassProbe,
} from "../src/doctor/bypass-probe.js";
import { APPROVE_MOD, BYPASS_PROMPT, writeApproveMod, writeProbeProject } from "../src/doctor/bypass-run.js";
import { recordProbeEvent } from "../src/doctor/probe.js";
import { fmPaths } from "../src/task/paths.js";
import { machine } from "./doctor-support.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime, found } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const PATHS = fmPaths(ROOT);
const NOW = "2026-10-26T12:00:00.000Z";

const runtimeWith = (files: Readonly<Record<string, string>> = {}) =>
  fakeRuntime({
    fs: memoryFs(files, [at(".git"), at(".fm"), at(".fm/cache")], NOW),
    tools: { claude: found("2.1.300 (Claude Code)") },
  });

describe("bypass probe", () => {
  it("never run, doctor says the event order is not confirmed for this Claude Code", () => {
    assert.deepEqual(
      bypassFindings("2.1.300", undefined).map((item) => [item.status, item.messageKey, item.params]),
      [["ok", "doctor.bypass.not_confirmed", { version: "2.1.300" }]],
    );
    assert.equal(bypassFindings(undefined, undefined).length, 0);
  });

  it("classifies what one probe session left behind", () => {
    assert.equal(classifyBypass({ denied: false, ran: true, recorded: false }), "inconclusive");
    assert.equal(classifyBypass({ denied: true, ran: true, recorded: true }), "fired");
    assert.equal(classifyBypass({ denied: true, ran: true, recorded: false }), "missed");
    assert.equal(classifyBypass({ denied: true, ran: false, recorded: false }), "held");
  });

  it("caches the result per Claude Code version and shows it", () => {
    const runtime = runtimeWith();
    writeBypassProbe(runtime, PATHS, { version: "2.1.300", at: NOW, outcome: "fired", instructions: 3 });
    writeBypassProbe(runtime, PATHS, { version: "2.1.299", at: NOW, outcome: "missed", instructions: 0 });
    assert.deepEqual(readBypassProbe(runtime, PATHS, "2.1.300"), {
      version: "2.1.300",
      at: NOW,
      outcome: "fired",
      instructions: 3,
    });
    assert.equal(readBypassProbe(runtime, PATHS, "2.1.301"), undefined);
    const env = { ...machine({}), root: ROOT, runtime };
    assert.deepEqual(
      checkBypassOrder(env).map((item) => [item.status, item.messageKey]),
      [["ok", "doctor.bypass.fired"]],
    );
    assert.deepEqual(
      bypassFindings("2.1.299", readBypassProbe(runtime, PATHS, "2.1.299")).map((item) => [item.status, item.fixKey]),
      [["warn", "doctor.bypass.missed_fix"]],
    );
  });

  it("reads the deny, the bypass record and the written file from the probe project", () => {
    const denied = JSON.stringify({ schemaVersion: 1, calls: [{ id: "t1", tool: "Write", summary: "x" }] }, null, 2);
    assert.deepEqual(bypassFacts(runtimeWith({ [at(".fm/cache/denied.json")]: denied }), PATHS), {
      denied: true,
      ran: false,
      recorded: false,
    });
    const recorded = runtimeWith({
      [at(".fm/bypasses.jsonl")]: `${JSON.stringify({ id: "t1", tool: "Write", summary: "x", at: NOW })}\n`,
      [at(BYPASS_PROBE_FILE)]: "probe",
    });
    assert.deepEqual(bypassFacts(recorded, PATHS), { denied: true, ran: true, recorded: true });
  });

  it("captures the InstructionsLoaded events of the probe session in the fixture format", () => {
    const runtime = runtimeWith();
    const kept = {
      session_id: "s1",
      hook_event_name: "InstructionsLoaded",
      file_path: "/home/ana/project/CLAUDE.md",
      memory_type: "Project",
      load_reason: "session_start",
    };
    const raw = { ...kept, content: "not kept" };
    recordProbeEvent(runtime, PATHS, "p1", "InstructionsLoaded", raw);
    recordProbeEvent(runtime, PATHS, "p1", "PreToolUse", {});
    recordProbeEvent(runtime, PATHS, "p2", "InstructionsLoaded", raw);
    assert.deepEqual(capturedInstructions(runtime, PATHS, "p1"), [kept]);
  });

  it("builds the scratch project and the approving fixture mod without starting claude", () => {
    const gitCalls: (readonly string[])[] = [];
    const runtime = fakeRuntime({
      fs: memoryFs({}, [], NOW),
      git: (args) => {
        gitCalls.push(args);
        return { found: true, ok: true, stdout: "" };
      },
    });
    const dir = toAbsolutePath(join(ROOT, ".fm", "cache", "bypass-probe-run", "x"));
    const work = writeProbeProject(runtime, dir);
    const mod = writeApproveMod(runtime, dir);
    assert.deepEqual(
      gitCalls.map((args) => args.find((arg) => ["init", "add", "commit"].includes(arg))),
      ["init", "add", "commit"],
    );
    const policy = runtime.readText(toAbsolutePath(join(work, ".fm", "policy.yml")));
    assert.ok(policy.ok && policy.value.includes("mod-tighten: off"));
    const register = runtime.readText(toAbsolutePath(join(mod, "hooks", "register.mjs")));
    assert.ok(register.ok && register.value === APPROVE_MOD);
    assert.match(BYPASS_PROMPT, new RegExp(BYPASS_PROBE_FILE.replace(/\./g, "\\.")));
  });
});
