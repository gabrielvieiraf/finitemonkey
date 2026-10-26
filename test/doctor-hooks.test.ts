import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doctorResult } from "../src/commands/doctor.js";
import { nodeExec } from "../src/core/node-exec.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { syntheticPayload } from "../src/doctor/hook-fire.js";
import { uncoveredTools } from "../src/doctor/hook-health.js";
import { hookSchemaProblems } from "../src/doctor/hook-schema.js";
import { buildReport, runChecks } from "../src/doctor/run.js";
import type { CheckFinding } from "../src/doctor/types.js";
import { HOOK_PROBE_ENV } from "../src/hooks/runner.js";
import { hookHandler, INSTALLED_HOOKS } from "../src/install/hook-entries.js";
import { pluginHooks } from "../src/install/plugin-hooks.js";
import {
  type Fixture,
  installedHooks,
  machine,
  NOT_OK,
  pluginFiles,
  runtimeFor,
  settings,
  versionAnswer,
} from "./doctor-support.js";
import { BUNDLE, bundle, cliJson, execResult, fakeCtx, field, parseBody, ROOT, TEST_VERSION } from "./support.js";

const ctx = fakeCtx();

const findings = (fixture: Fixture): readonly CheckFinding[] => runChecks(machine(fixture));

const byCheck = (fixture: Fixture, check: string): CheckFinding | undefined =>
  findings(fixture).find((finding) => finding.check === check);

const exitOf = (fixture: Fixture): number => doctorResult(ctx, buildReport(ctx, findings(fixture))).exitCode;

const hookArgs = (request: ExecRequest): boolean => request.args.includes("hook");

const NO_PROJECT_HOOKS = { ".claude/settings.json": undefined, ".finitemonkey/lock.json": undefined };

describe("doctor fires each hook", () => {
  it("a healthy install reports every hook ok and fires nothing red", () => {
    const log: ExecRequest[] = [];
    const all = findings({ execLog: log });
    assert.deepEqual(all.filter(NOT_OK), []);
    const hooks = all.filter((finding) => finding.hook !== undefined);
    assert.equal(hooks.length, INSTALLED_HOOKS.length);
    assert.ok(hooks.every((finding) => finding.hook === "ok"));
    const fired = log.filter(hookArgs);
    assert.equal(fired.length, INSTALLED_HOOKS.length);
    for (const request of fired) {
      assert.equal(request.env?.[HOOK_PROBE_ENV], "1");
      assert.equal(request.env["CLAUDE_PROJECT_DIR"] ?? "", machine().root);
      assert.ok(!request.args.some((arg) => arg.includes("${")), request.args.join(" "));
      const event = request.args[request.args.indexOf("hook") + 1];
      assert.equal(field(parseBody(request.input ?? "{}"), "hook_event_name"), event);
    }
  });

  const broken: readonly { readonly name: string; readonly answer: ReturnType<typeof execResult> }[] = [
    { name: "a command that exits 1", answer: execResult(1, "", "Error: Cannot find module") },
    { name: "a command that is not found", answer: { ...execResult(null), found: false } },
    { name: "a command that prints no JSON", answer: execResult(0, "hello") },
    { name: "a command that times out", answer: { ...execResult(null), timedOut: true } },
  ];
  for (const { name, answer } of broken) {
    it(`${name} is broken and turns doctor red`, () => {
      const fixture: Fixture = {
        exec: (request) => (hookArgs(request) && request.args.includes("PreToolUse") ? answer : undefined),
      };
      const finding = byCheck(fixture, "hook.project.PreToolUse");
      assert.equal(finding?.hook, "broken");
      assert.equal(finding.status, "fail");
      assert.equal(exitOf(fixture), 1);
    });
  }

  it("a slow hook is degraded", () => {
    const fixture: Fixture = {
      exec: (request) => (hookArgs(request) ? { ...execResult(0, "{}"), durationMs: 2400 } : undefined),
    };
    assert.equal(byCheck(fixture, "hook.project.Stop")?.hook, "degraded");
  });
});

describe("doctor validates hook registrations", () => {
  it("an invalid plugin hooks.json turns doctor red", () => {
    for (const hooks of ["{ not json", settings({ hooks: { NotAnEvent: [] } })]) {
      const fixture: Fixture = { files: pluginFiles(true, hooks) };
      assert.equal(byCheck(fixture, "hooks.schema")?.status, "fail", hooks);
      assert.equal(exitOf(fixture), 1);
    }
  });

  it("invalid project hook entries turn doctor red", () => {
    const hooks = { PreToolUse: [{ hooks: [{ type: "command", command: "", timeout: -1 }] }] };
    const fixture: Fixture = { project: { ".claude/settings.json": settings({ hooks }) } };
    assert.match(String(byCheck(fixture, "hooks.schema")?.params?.["problems"]), /command: empty; .*timeout/);
    assert.equal(exitOf(fixture), 1);
  });

  it("onFailure is reported against an older Claude Code", () => {
    assert.deepEqual(hookSchemaProblems(pluginHooks()["hooks"], [2, 1, 300]), []);
    assert.match(hookSchemaProblems(pluginHooks()["hooks"], [2, 1, 200]).join(), /onFailure: needs Claude Code/);
  });

  it("a disabled plugin turns doctor red", () => {
    const fixture: Fixture = { files: pluginFiles(false), project: NO_PROJECT_HOOKS };
    assert.equal(byCheck(fixture, "hooks.plugin")?.status, "fail");
    assert.equal(exitOf(fixture), 1);
  });

  it("an enabled plugin alone is fired and passes", () => {
    const fixture: Fixture = { files: pluginFiles(true), project: NO_PROJECT_HOOKS };
    const all = findings(fixture);
    assert.deepEqual(all.filter(NOT_OK), []);
    assert.equal(all.filter((finding) => finding.check.startsWith("hook.plugin.")).length, INSTALLED_HOOKS.length);
  });

  it("missing hook events are reported", () => {
    const hooks = { ...installedHooks(), Stop: undefined };
    const fixture: Fixture = { project: { ".claude/settings.json": settings({ hooks }) } };
    const finding = byCheck(fixture, "hooks.registered");
    assert.equal(finding?.status, "fail");
    assert.equal(finding.params?.["events"], "Stop");
  });

  it("a guard without onFailure block or without the shell matcher is degraded", () => {
    const pre = INSTALLED_HOOKS.find((spec) => spec.event === "PreToolUse");
    assert.ok(pre !== undefined);
    const openGuard = hookHandler({ kind: "local" }, pre, false);
    const hooks = { ...installedHooks(), PreToolUse: [{ matcher: "Bash", hooks: [openGuard] }] };
    const finding = byCheck({ project: { ".claude/settings.json": settings({ hooks }) } }, "hook.project.PreToolUse");
    assert.equal(finding?.hook, "degraded");
    assert.equal(finding.messageKey, "doctor.hooks.fail_open");
    assert.deepEqual(uncoveredTools("Bash"), ["PowerShell"]);
    assert.deepEqual(uncoveredTools("Bash|PowerShell"), []);
    assert.deepEqual(uncoveredTools(undefined), []);
    const matched = {
      ...installedHooks(),
      PreToolUse: [{ matcher: "Edit|Write", hooks: [hookHandler({ kind: "local" }, pre, true)] }],
    };
    const coverage = byCheck(
      { project: { ".claude/settings.json": settings({ hooks: matched }) } },
      "hook.project.PreToolUse",
    );
    assert.equal(coverage?.messageKey, "doctor.hooks.matcher");
    assert.equal(coverage.params?.["tools"], "Bash, PowerShell");
  });
});

describe("doctor compares versions", () => {
  const olderProject: Fixture = {
    files: pluginFiles(true),
    exec: (request) => (request.args.includes("version") ? versionAnswer("0.1.0-next.1") : undefined),
  };

  it("a project executable older than the plugin is a failure with the fixing command", () => {
    const finding = byCheck(olderProject, "hooks.version");
    assert.equal(finding?.status, "fail");
    const report = buildReport(ctx, findings(olderProject));
    const item = report.checks.find((check) => check.check === "hooks.version");
    assert.equal(item?.fix, `Align the project with the plugin: npx finitemonkey@${TEST_VERSION} update --yes`);
  });

  it("does not fire hooks of another version", () => {
    const log: ExecRequest[] = [];
    const all = findings({ ...olderProject, project: {}, files: {}, execLog: log });
    assert.equal(log.filter(hookArgs).length, 0);
    assert.equal(all.find((finding) => finding.check === "hook.project.Stop")?.messageKey, "doctor.hooks.not_fired");
    assert.equal(all.find((finding) => finding.check === "hooks.version")?.status, "warn");
  });
});

describe("doctor --json lists hooks", () => {
  it("each hook has check, status and fix", async () => {
    const result = await cliJson(["doctor"], {
      runtime: runtimeFor({ exec: (request) => (request.args.includes("SessionStart") ? execResult(3) : undefined) }),
    });
    const raw = field(result.body, "data", "hooks");
    assert.ok(Array.isArray(raw));
    const hooks: readonly unknown[] = raw;
    assert.equal(hooks.length, INSTALLED_HOOKS.length);
    for (const hook of hooks) {
      assert.ok(typeof hook === "object" && hook !== null);
      assert.deepEqual(Object.keys(hook).sort(), ["check", "fix", "status"]);
    }
    const session = hooks.find((hook) => field(hook, "check") === "hook.project.SessionStart");
    assert.equal(field(session, "status"), "broken");
    assert.equal(typeof field(session, "fix"), "string");
    assert.equal(
      field(
        hooks.find((hook) => field(hook, "check") === "hook.project.Stop"),
        "fix",
      ),
      null,
    );
  });
});

describe("hook probe mode", () => {
  it("the bundle answers a synthetic payload without running the handlers", () => {
    for (const event of ["Stop", "PreToolUse", "SessionStart"]) {
      const result = bundle(["hook", event], syntheticPayload(event, ROOT), { [HOOK_PROBE_ENV]: "1" });
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { continue: true });
    }
  });

  it("fires the real bundle for every installed hook", () => {
    const hooks = Object.fromEntries(
      INSTALLED_HOOKS.map((spec) => [
        spec.event,
        [{ hooks: [hookHandler({ kind: "path", path: BUNDLE }, spec, true)] }],
      ]),
    );
    const fixture: Fixture = {
      project: { ".claude/settings.json": settings({ hooks }) },
      exec: (request) => {
        const result = nodeExec({ ...request, cwd: ROOT });
        return request.args.includes("version")
          ? { ...result, stdout: result.stdout.replace(/"version":"[^"]+"/, `"version":"${TEST_VERSION}"`) }
          : result;
      },
    };
    const hookFindings = findings(fixture).filter((finding) => finding.hook !== undefined);
    assert.equal(hookFindings.length, INSTALLED_HOOKS.length);
    for (const finding of hookFindings) assert.notEqual(finding.hook, "broken", JSON.stringify(finding));
  });
});
