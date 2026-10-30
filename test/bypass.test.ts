import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { checkMods, riskyReach } from "../src/doctor/mods.js";
import { unreviewedBypasses } from "../src/guards/bypass/ledger.js";
import { fmPaths } from "../src/task/paths.js";
import { machine, PLUGIN_INDEX, settings, USER_SETTINGS } from "./doctor-support.js";
import { FakeClaude } from "./fake-claude.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { cliJson, execResult, field, ROOT } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const ttyStdin = (): Readable => Object.assign(Readable.from([]), { isTTY: true });

const FORCE = {
  tool_name: "Bash",
  tool_input: { command: "git push --force origin main" },
  tool_use_id: "toolu_force",
};

describe("guard bypass by another mod", () => {
  it("a call a guard denied that still runs is recorded, and ci gate refuses until the person reviews it", async () => {
    const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
    repos.push(repo);
    const root = toAbsolutePath(realpathSync.native(repo.root));
    const claude = new FakeClaude({ project: root, pluginRoot: `${ROOT}/plugin` });
    await claude.play([
      { kind: "event", event: "PreToolUse", payload: FORCE },
      { kind: "event", event: "PostToolUse", payload: { ...FORCE, tool_response: { stdout: "" } } },
    ]);
    assert.equal(claude.blocks("PreToolUse"), 1);
    assert.equal(claude.blocks("PostToolUse"), 1, JSON.stringify(claude.runs));
    const open = unreviewedBypasses(repoRuntime(), fmPaths(root));
    assert.deepEqual(
      open.map((entry) => [entry.id, entry.tool]),
      [["toolu_force", "Bash"]],
    );

    const refused = await cliJson(["ci", "gate", "--base", "HEAD"], { cwd: root, runtime: repoRuntime() });
    assert.equal(field(refused.body, "error", "code"), "guard_bypassed");

    const byAgent = await cliJson(["bypass", "review", "--all"], { cwd: root, runtime: repoRuntime() });
    assert.equal(field(byAgent.body, "error", "code"), "needs_confirmation");
    const byPerson = await cliJson(["bypass", "review", "--all"], {
      cwd: root,
      runtime: repoRuntime(),
      stdin: ttyStdin(),
    });
    assert.deepEqual(field(byPerson.body, "data", "reviewed"), ["toolu_force"]);
    assert.deepEqual(unreviewedBypasses(repoRuntime(), fmPaths(root)), []);
  });

  it("a denied call that never runs leaves nothing to review", async () => {
    const repo = makeRepo({ "src/a.js": "export const a = 1;\n" });
    repos.push(repo);
    const root = toAbsolutePath(realpathSync.native(repo.root));
    const claude = new FakeClaude({ project: root, pluginRoot: `${ROOT}/plugin` });
    await claude.play([{ kind: "event", event: "PreToolUse", payload: FORCE }]);
    assert.deepEqual(unreviewedBypasses(repoRuntime(), fmPaths(root)), []);
  });
});

describe("doctor audits the reach of installed mods", () => {
  const FIREWALL = "/home/test/.claude/plugins/cache/market/firewall/1.0.0";
  const files = {
    [PLUGIN_INDEX]: settings({
      version: 2,
      plugins: { "firewall@market": [{ scope: "user", installPath: FIREWALL, version: "1.0.0" }] },
    }),
    [`${FIREWALL}/hooks/hooks.json`]: settings({ modules: ["./register.js"] }),
    [USER_SETTINGS]: settings({ enabledPlugins: { "firewall@market": true } }),
  };
  const validate = JSON.stringify({
    contents: [{ type: "hooks", notes: ["./register.js hooks: tool.check{tool=Bash}, ui.render{component=Pane}"] }],
  });

  it("names a mod that hooks tool.check and how to put finitemonkey first", () => {
    const env = machine({
      files,
      exec: (request) => (request.args.includes("validate") ? execResult(0, validate) : undefined),
    });
    const findings = checkMods(env);
    assert.deepEqual(
      findings.map((item) => [item.status, item.messageKey, item.params?.["plugin"], item.fixKey]),
      [["warn", "doctor.mods.reach", "firewall@market", "doctor.mods.fix"]],
    );
  });

  it("reads which hooks can defeat a guard from claude plugin validate notes", () => {
    assert.deepEqual(
      riskyReach([
        "./r.js hooks: tool.call, tool.call{tool=Bash}, tool.check, ui.render{component=AskUserQuestion}, session.append, turn.step",
      ]),
      ["tool.call", "tool.check", "ui.render{component=AskUserQuestion}", "session.append"],
    );
  });
});
