import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { footprintDiff, footprintOf, parseFootprint } from "../scripts/mod-footprint.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { isRecord } from "../src/core/parsed.js";
import { PLUGIN_MOD, pluginHooks } from "../src/install/plugin-hooks.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { FakeClaude, type Step } from "./fake-claude.js";
import { makeRepo, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { parseBody, ROOT } from "./support.js";

const FAILING_TEST = PASSING_TEST.replace("assert.equal(1 + 1, 2)", "assert.equal(1 + 1, 3)");
const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const withoutModules = (config: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(config).filter(([key]) => key !== "modules"));

const pluginWithoutMod = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "fm-nomod-"));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  cpSync(join(ROOT, "plugin"), dir, { recursive: true });
  const file = join(dir, "hooks", "hooks.json");
  const config = parseBody(readFileSync(file, "utf8"));
  assert.ok(isRecord(config));
  writeFileSync(file, JSON.stringify(withoutModules(config)));
  rmSync(join(dir, "hooks", "register.mjs"));
  return realpathSync.native(dir);
};

const project = (): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
  cleanups.push(() => {
    repo.cleanup();
  });
  const root = toAbsolutePath(realpathSync.native(repo.root));
  const created = createTask(repoRuntime(), fmPaths(root), {
    id: "t1",
    goal: "change a",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [],
    tests: "node --test",
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  return repo;
};

const bash = (command: string): Step => ({
  kind: "event",
  event: "PreToolUse",
  payload: { tool_name: "Bash", tool_input: { command }, tool_use_id: "toolu_1" },
});

describe("mod adapter next to the command hooks", () => {
  it("hooks.json only adds the module to the command-hook table", () => {
    const config = parseBody(readFileSync(join(ROOT, "plugin", "hooks", "hooks.json"), "utf8"));
    assert.ok(isRecord(config));
    assert.deepEqual(config["modules"], [PLUGIN_MOD]);
    assert.deepEqual(withoutModules(config), withoutModules(pluginHooks()));
  });

  it("with the mod removed, a guard still blocks and the gate still stops a false done", async () => {
    const repo = project();
    const claude = new FakeClaude({ project: realpathSync.native(repo.root), pluginRoot: pluginWithoutMod() });
    await claude.play([
      bash("git push --force origin main"),
      {
        kind: "act",
        run: () => {
          repo.write("test/a.test.js", FAILING_TEST);
        },
      },
      {
        kind: "event",
        event: "PostToolUse",
        payload: { tool_name: "Write", tool_input: { file_path: "test/a.test.js" }, tool_response: { success: true } },
      },
      { kind: "event", event: "Stop", payload: { last_assistant_message: "Done, tests pass." } },
    ]);
    assert.equal(claude.blocks("PreToolUse"), 1, JSON.stringify(claude.runs));
    assert.equal(claude.blocks("Stop"), 1, JSON.stringify(claude.runs));
  });
});

describe("mod footprint", () => {
  const report = (notes: readonly string[]): unknown => ({
    contents: [
      {
        type: "hooks",
        notes,
        gatingHooks: [{ module: "./register.mjs", hook: "tool.check", hasCatch: true }],
      },
    ],
  });

  it("reads the module's reach from claude plugin validate --json", () => {
    const footprint = footprintOf(
      report(["./register.mjs hooks: tool.check", "./register.mjs calls: $.process.run", "./other.mjs hooks: x"]),
    );
    assert.ok(footprint !== undefined);
    assert.deepEqual(footprint.reach, ["calls: $.process.run", "hooks: tool.check"]);
    assert.deepEqual(footprint.gating, [{ hook: "tool.check", hasCatch: true }]);
  });

  it("names a new call that the committed footprint does not have", () => {
    const committed = footprintOf(report(["./register.mjs calls: $.process.run"]));
    const fresh = footprintOf(report(["./register.mjs calls: $.process.run, $.http.fetch"]));
    assert.ok(committed !== undefined && fresh !== undefined);
    assert.deepEqual(footprintDiff(committed, fresh), [
      "+ calls: $.process.run, $.http.fetch",
      "- calls: $.process.run",
    ]);
  });

  it("the committed plugin/FOOTPRINT.json parses", () => {
    const committed = parseFootprint(readFileSync(join(ROOT, "plugin", "FOOTPRINT.json"), "utf8"));
    assert.ok(committed !== undefined);
    assert.ok(committed.reach.some((line) => line.startsWith("hooks: ")));
  });
});
