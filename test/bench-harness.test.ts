import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { type Arm, loadArms } from "../scripts/bench-arms.js";
import { insideRepo } from "../scripts/bench-claude.js";
import { type BenchTask, type HarnessConfig, type HarnessDeps, runBench, schedule } from "../scripts/bench-harness.js";
import { benchHooks, type Invocation, type PinnedPlugin } from "../scripts/bench-invoke.js";
import { plan } from "../scripts/bench-plan.js";
import { freeze, verifyFrozen } from "../scripts/bench-prereg.js";
import { commitWorkspace } from "../scripts/bench-tasks.js";
import { checkInjection } from "../scripts/bench-transcript.js";
import { BENCH_RUN_ENV } from "../src/commands/hook.js";
import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { cli, ROOT, stdinFrom } from "./support.js";

const BENCH = join(ROOT, "bench");
const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const scratch = (): string => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-bench-test-")));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

const arms = (): readonly Arm[] => {
  const loaded = loadArms(join(BENCH, "arms"));
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.error);
  return loaded.value;
};

const armOf = (id: string): Arm => {
  const arm = arms().find((item) => item.id === id);
  assert.ok(arm !== undefined, id);
  return arm;
};

const pluginHooks = (): PinnedPlugin => {
  const root = join(ROOT, "plugin");
  const hooks = parseJsonObject(readFileSync(join(root, "hooks", "hooks.json"), "utf8"));
  assert.ok(hooks.ok);
  return { root, hooks: hooks.value };
};

const commandsOf = (settings: JsonObject, event: string): readonly (readonly string[])[] => {
  const hooks = settings["hooks"];
  const groups = isRecord(hooks) && Array.isArray(hooks[event]) ? hooks[event] : [];
  return groups.flatMap((group: unknown) => {
    const handlers = isRecord(group) && Array.isArray(group["hooks"]) ? group["hooks"] : [];
    return handlers.flatMap((handler: unknown) => {
      if (!isRecord(handler) || typeof handler["command"] !== "string" || !Array.isArray(handler["args"])) return [];
      const args = handler["args"].filter((arg: unknown): arg is string => typeof arg === "string");
      return [[handler["command"], ...args]];
    });
  });
};

const STREAM_INIT = (plugins: readonly string[]): string =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    model: "claude-sonnet-test",
    plugins: plugins.map((name) => ({ name })),
  });

const STREAM_RESULT = JSON.stringify({
  type: "result",
  total_cost_usd: 0.12,
  num_turns: 3,
  usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 },
});

const fakeRunner = async (
  invocation: Invocation,
): Promise<{
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}> => {
  for (const event of ["SessionStart", "Stop"]) {
    for (const [command, ...args] of commandsOf(invocation.settings, event)) {
      if (command === undefined) continue;
      const input = JSON.stringify({ session_id: "s1", cwd: invocation.cwd, hook_event_name: event });
      spawnSync(command, args, {
        cwd: invocation.cwd,
        input,
        encoding: "utf8",
        env: { ...process.env, ...invocation.env, CLAUDE_PROJECT_DIR: invocation.cwd },
      });
    }
  }
  const fm = invocation.args.includes("--plugin-dir");
  const stdout = [STREAM_INIT(fm ? ["finitemonkey"] : []), STREAM_RESULT, ""].join("\n");
  return Promise.resolve({ exitCode: 0, durationMs: 5, stdout, stderr: "" });
};

const task: BenchTask = {
  id: "sum",
  prompt: (seed) => `Fix sum, seed ${String(seed)}`,
  materialize: (workdir, seed) => {
    writeFileSync(join(workdir, "sum.js"), `exports.sum = (a, b) => a - b; // ${String(seed)}\n`);
    commitWorkspace(workdir);
  },
};

const deps = (roots: string[]): HarnessDeps => ({
  runner: fakeRunner,
  claudeVersion: "2.1.300 (Claude Code)",
  pluginFor: (arm) => (arm.finitemonkey ? pluginHooks() : undefined),
  tempRoot: () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-bench-run-")));
    roots.push(root);
    return root;
  },
  insideRepo,
  now: () => "2026-10-28T00:00:00.000Z",
});

const config = (outDir: string, picked: readonly Arm[]): HarnessConfig => ({
  outDir,
  seed: 7,
  repeats: 1,
  model: "sonnet",
  maxBudgetUsd: 1,
  configDir: "/nonexistent/claude-config",
  freeze: { sha256: "a".repeat(64), frozenAt: "2026-10-28", personas: {} },
  tasks: [task],
  arms: picked,
});

describe("bench plan", () => {
  const input = { tasks: ["a", "b", "c"], arms: ["plain", "fm"], repeats: 3, seed: 11 };

  it("the same seed gives the same schedule and another seed reorders it", () => {
    assert.deepEqual(plan(input), plan(input));
    assert.notDeepEqual(
      plan(input).map((run) => run.id),
      plan({ ...input, seed: 12 }).map((run) => run.id.replace("--s12", "--s11")),
    );
  });

  it("interleaves arms inside each task block and pairs them on one task seed", () => {
    const runs = plan(input);
    assert.equal(runs.length, 18);
    for (let index = 0; index < runs.length; index += 2) {
      const [first, second] = [runs[index], runs[index + 1]];
      assert.ok(first !== undefined && second !== undefined);
      assert.equal(first.task, second.task);
      assert.notEqual(first.arm, second.arm);
      assert.equal(first.taskSeed, second.taskSeed);
    }
  });
});

describe("bench arms and pre-registration", () => {
  it("the committed arms parse, include plain Claude Code and the three ricochet arms", () => {
    assert.deepEqual(
      arms()
        .map((arm) => arm.id)
        .sort(),
      ["fm", "horizon", "horizon-criterion", "no-detector", "plain"],
    );
    assert.equal(armOf("plain").finitemonkey, false);
  });

  it("the pre-registration matches its frozen hash, and an edit after the freeze is refused", () => {
    assert.ok(verifyFrozen(BENCH).ok);
    const copy = scratch();
    cpSync(BENCH, copy, { recursive: true, filter: (path) => !path.includes("results") });
    writeFileSync(join(copy, "PREREGISTRATION.md"), "# Changed after the freeze\n");
    assert.equal(verifyFrozen(copy).ok, false);
    freeze(copy, "2026-10-29");
    assert.ok(verifyFrozen(copy).ok);
    writeFileSync(join(copy, "personas", "novice.json"), "{}\n");
    const changed = verifyFrozen(copy);
    assert.match(changed.ok ? "" : changed.error, /persona files changed/);
  });
});

describe("bench invocation", () => {
  it("swaps the plugin marker for the run id and expands the pinned plugin root", () => {
    const settings = { hooks: benchHooks(pluginHooks(), "sum--fm--r0--s7") };
    const commands = commandsOf(settings, "Stop");
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.ok(command.includes("--bench-run") && command.includes("sum--fm--r0--s7"));
      assert.ok(!command.includes("--via"));
      assert.ok(command.every((arg) => !arg.includes("${CLAUDE_PLUGIN_ROOT}")));
    }
  });
});

describe("bench harness on a fake runner", () => {
  it("runs each arm in a temp folder outside any repo, records it and proves what was injected", async () => {
    const out = scratch();
    const roots: string[] = [];
    const records = await runBench(config(out, [armOf("plain"), armOf("fm")]), deps(roots));
    assert.equal(records.length, 2);
    for (const record of records) {
      assert.deepEqual(record.injection.problems, []);
      assert.equal(record["preregistration"], "a".repeat(64));
      assert.equal(record["claudeVersion"], "2.1.300 (Claude Code)");
      assert.equal(record["reportedModel"], "claude-sonnet-test");
      assert.equal(record["inputTokens"], 150);
      assert.ok(existsSync(join(out, "runs", record.run, "transcript.jsonl")));
    }
    const fm = records.find((record) => record["arm"] === "fm");
    assert.deepEqual(fm?.injection.hooks, ["SessionStart", "Stop"]);
    assert.ok(roots.every((root) => !existsSync(root)));
    assert.equal(readFileSync(join(out, "runs.jsonl"), "utf8").trim().split("\n").length, 2);
  });

  it("one command and one seed reproduce a single run of the schedule", async () => {
    const first = schedule({ ...config("", arms()), repeats: 2 });
    const target = first[3];
    assert.ok(target !== undefined);
    const again = schedule({ ...config("", arms()), repeats: 2, only: target.id });
    assert.deepEqual(again, [target]);
    const records = await runBench({ ...config(scratch(), arms()), repeats: 2, only: target.id }, deps([]));
    assert.deepEqual(
      records.map((record) => [record.run, record["taskSeed"], record["order"]]),
      [[target.id, target.taskSeed, target.order]],
    );
  });

  it("refuses a run folder inside a git repository", async () => {
    const roots: string[] = [];
    await assert.rejects(
      runBench(config(scratch(), [armOf("plain")]), { ...deps(roots), insideRepo: () => true }),
      /inside a git repository/,
    );
    assert.ok(roots.every((root) => !existsSync(root)));
  });
});

describe("bench injection check", () => {
  const hook = (run: string, event: string): string => JSON.stringify({ event: "bench_hook", run, hook: event });

  it("flags a plain run where Finite Monkey ran or showed up", () => {
    const result = checkInjection(armOf("plain"), "r1", '{"text":"finitemonkey"}', hook("r1", "Stop"));
    assert.equal(result.problems.length, 2);
  });

  it("flags a Finite Monkey run where no hook ran, a hook ran for another run, or the plugin was missing", () => {
    assert.equal(checkInjection(armOf("fm"), "r1", "", "").ok, false);
    assert.equal(checkInjection(armOf("fm"), "r1", "", hook("r2", "Stop")).ok, false);
    assert.equal(checkInjection(armOf("fm"), "r1", STREAM_INIT([]), hook("r1", "Stop")).ok, false);
    assert.equal(checkInjection(armOf("fm"), "r1", STREAM_INIT(["finitemonkey"]), hook("r1", "Stop")).ok, true);
  });

  it("the bench env makes plugin hooks yield to the injected ones", async () => {
    const result = await cli(["hook", "Stop", "--via", "plugin"], {
      env: { [BENCH_RUN_ENV]: "r1" },
      stdin: stdinFrom("not json"),
    });
    assert.equal(result.stdout, '{"continue":true}\n');
  });
});
