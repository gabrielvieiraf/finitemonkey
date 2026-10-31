import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { report } from "../scripts/bench-analysis-lib.js";
import { type Arm, loadArms } from "../scripts/bench-arms.js";
import { inspectWith } from "../scripts/bench-claude.js";
import { type Family, loadFamilies, loadPersonas, type Persona, type Solution } from "../scripts/bench-family.js";
import { type HarnessDeps, runBench } from "../scripts/bench-harness.js";
import type { Invocation, PinnedPlugin } from "../scripts/bench-invoke.js";
import { loadPhase, type Phase, phaseRuns } from "../scripts/bench-phase.js";
import { applySolution, suiteTasks, varsFor } from "../scripts/bench-suite.js";
import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { field, ROOT } from "./support.js";

const BENCH = join(ROOT, "bench");
const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const scratch = (): string => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-main-e2e-")));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

const ok = <T>(
  parsed: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
): T => {
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  return parsed.value;
};

const arms = (): readonly Arm[] => ok(loadArms(join(BENCH, "arms")));
const families = (): readonly Family[] => ok(loadFamilies(join(BENCH, "tasks"), "public"));
const personas = (): readonly Persona[] => ok(loadPersonas(join(BENCH, "personas")));
const main = (): Phase => ok(loadPhase(BENCH, "main"));

const pluginHooks = (): PinnedPlugin => {
  const root = join(ROOT, "plugin");
  return { root, hooks: ok(parseJsonObject(readFileSync(join(root, "hooks", "hooks.json"), "utf8"))) };
};

const commandsOf = (settings: JsonObject, event: string): readonly (readonly string[])[] => {
  const hooks = settings["hooks"];
  const groups = isRecord(hooks) && Array.isArray(hooks[event]) ? hooks[event] : [];
  return groups.flatMap((group: unknown) => {
    const handlers = isRecord(group) && Array.isArray(group["hooks"]) ? group["hooks"] : [];
    return handlers.flatMap((handler: unknown) => {
      if (!isRecord(handler) || typeof handler["command"] !== "string" || !Array.isArray(handler["args"])) return [];
      return [
        [handler["command"], ...handler["args"].filter((arg: unknown): arg is string => typeof arg === "string")],
      ];
    });
  });
};

interface Scripted {
  readonly solution: Solution;
  readonly messages: readonly string[];
}

const agentRunner =
  (
    lookup: (prompt: string) => { readonly family: Family; readonly taskSeed: number } | undefined,
    script: (fm: boolean) => Scripted,
  ) =>
  (invocation: Invocation) => {
    const fm = invocation.args.includes("--plugin-dir");
    const prompt = invocation.args[invocation.args.indexOf("--print") + 1] ?? "";
    const hook = (event: string): void => {
      for (const [command, ...args] of commandsOf(invocation.settings, event)) {
        if (command === undefined) continue;
        spawnSync(command, args, {
          cwd: invocation.cwd,
          input: JSON.stringify({ session_id: "s1", cwd: invocation.cwd, hook_event_name: event, prompt }),
          encoding: "utf8",
          env: { ...process.env, ...invocation.env, CLAUDE_PROJECT_DIR: invocation.cwd },
        });
      }
    };
    hook("SessionStart");
    hook("UserPromptSubmit");
    const target = lookup(prompt);
    const { solution, messages } = script(fm);
    if (target !== undefined)
      applySolution(target.family, solution, invocation.cwd, varsFor(target.family, target.taskSeed));
    hook("Stop");
    const stdout = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "s1",
        model: "claude-sonnet-test",
        plugins: fm ? [{ name: "finitemonkey" }] : [],
      }),
      ...messages
        .slice(0, -1)
        .map((text) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })),
      JSON.stringify({
        type: "result",
        result: messages.at(-1),
        total_cost_usd: fm ? 0.3 : 0.1,
        num_turns: 4,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      "",
    ].join("\n");
    return Promise.resolve({ exitCode: 0, durationMs: fm ? 200 : 100, stdout, stderr: "" });
  };

const SCRIPTS: Readonly<Record<string, (fm: boolean) => Scripted>> = {
  "notes-idor": (fm) =>
    fm
      ? {
          solution: "right",
          messages: [
            "Notes are private, so I made sure another user cannot change someone else's note.",
            "Done. The owner can now edit a note and all tests pass.",
          ],
        }
      : { solution: "wrong", messages: ["Done. Notes can now be edited and all tests pass."] },
  "supplement-evidence": (fm) =>
    fm
      ? {
          solution: "right",
          messages: [
            "The studies disagree and the blog misquotes the first trial.",
            "Done. The answer is in answer.md.",
          ],
        }
      : { solution: "wrong", messages: ["Done. The answer is in answer.md."] },
};

describe("main round end to end on the fake runner", () => {
  it("scores one code and one research family per arm, collects Finite Monkey's view and reports it", async () => {
    const picked = families().filter((family) => family.id in SCRIPTS);
    const lay = personas().filter((persona) => persona.id === "layperson");
    const tasks = suiteTasks(picked, lay);
    const runArms = arms().filter((arm) => arm.id === "plain" || arm.id === "fm");
    const phase: Phase = {
      ...main(),
      groups: [
        {
          name: "primary",
          families: picked.map((family) => family.id),
          personas: ["layperson"],
          arms: ["plain", "fm"],
          repeats: 1,
        },
      ],
    };
    const runs = phaseRuns(phase, 3);
    const lookup = (prompt: string) => {
      for (const run of runs) {
        const task = tasks.find((item) => item.id === run.task);
        const family = picked.find((item) => run.task.startsWith(`${item.id}.`));
        if (task !== undefined && family !== undefined && task.prompt(run.taskSeed) === prompt) {
          return { family, taskSeed: run.taskSeed };
        }
      }
      return undefined;
    };
    const roots: string[] = [];
    const deps: HarnessDeps = {
      runner: (invocation) => {
        const target = lookup(invocation.args[invocation.args.indexOf("--print") + 1] ?? "");
        const script = SCRIPTS[target?.family.id ?? ""];
        assert.ok(script !== undefined);
        return agentRunner(lookup, script)(invocation);
      },
      claudeVersion: "2.1.300 (Claude Code)",
      pluginFor: (arm) => (arm.finitemonkey ? pluginHooks() : undefined),
      tempRoot: () => {
        const root = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-main-run-")));
        roots.push(root);
        return root;
      },
      insideRepo: () => false,
      now: () => "2026-10-30T12:00:00.000Z",
      settle: () => Promise.resolve(),
      inspect: inspectWith((arm) => (arm.finitemonkey ? pluginHooks() : undefined)),
    };
    const out = scratch();
    const records = await runBench(
      {
        outDir: out,
        seed: 3,
        repeats: 1,
        model: "sonnet",
        maxBudgetUsd: 0.75,
        configDir: "/nonexistent/claude-config",
        freeze: { sha256: "a".repeat(64), frozenAt: "2026-10-29", personas: {} },
        tasks,
        arms: runArms,
        runs,
        onboard: "self-report",
        phase: "main",
      },
      deps,
    );
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    assert.equal(records.length, 4);
    const byRun = (family: string, arm: string): JsonObject => {
      const found = records.find((record) => record["family"] === family && record["arm"] === arm);
      assert.ok(found !== undefined, `${family} ${arm}`);
      return found;
    };
    for (const record of records) assert.deepEqual(record.injection.problems, [], record.run);

    const fmCode = byRun("notes-idor", "fm");
    assert.deepEqual(
      [
        "oracleGreen",
        "trapGreen",
        "unsafe",
        "claimedDone",
        "falseDone",
        "trapSurfaced",
        "trapSurfacedBeforeDone",
        "phase",
        "onboard",
      ].map((key) => fmCode[key]),
      [true, true, false, true, false, true, true, "main", "self-report"],
    );
    assert.equal(field(fmCode, "instruments", "collected"), true);
    assert.equal(field(fmCode, "instruments", "perfil", "present"), true);
    assert.equal(field(fmCode, "instruments", "perfil", "taskDomain"), "right");
    assert.equal(field(fmCode, "instruments", "truth"), "beyond");
    assert.ok(typeof field(fmCode, "instruments", "xray", "verdict") === "string");
    assert.ok(typeof field(fmCode, "instruments", "blindBand", "verdict") === "string");
    assert.ok(typeof field(fmCode, "instruments", "trajectory", "verdict") === "string");
    const saved = join(out, "runs", String(fmCode["run"]));
    assert.ok(existsSync(join(saved, "finitemonkey", "perfil.yml")));
    const view = ok(parseJsonObject(readFileSync(join(saved, "views", "perfil.json"), "utf8")));
    assert.equal(view["ok"], true);
    assert.equal(field(view, "data", "domains", "security", "knowledge", "level"), "beginner");
    for (const name of ["conceitos", "trajectory", "xray", "blind-band", "probe-gap", "judge-report"]) {
      assert.ok(existsSync(join(saved, "views", `${name}.json`)), name);
    }

    const plainCode = byRun("notes-idor", "plain");
    assert.deepEqual(
      ["oracleGreen", "trapGreen", "unsafe", "falseDone", "trapSurfaced", "onboard", "instruments"].map(
        (key) => plainCode[key],
      ),
      [false, false, true, true, false, null, null],
    );
    assert.ok(!existsSync(join(out, "runs", String(plainCode["run"]), "finitemonkey")));

    const fmResearch = byRun("supplement-evidence", "fm");
    assert.deepEqual(
      ["oracleGreen", "falseDone", "trapSurfaced", "kind"].map((key) => fmResearch[key]),
      [true, false, true, "research"],
    );
    assert.equal(field(fmResearch, "instruments", "perfil", "taskDomain"), "not-a-perfil-domain");
    const plainResearch = byRun("supplement-evidence", "plain");
    assert.deepEqual(
      ["oracleGreen", "falseDone", "unsafe"].map((key) => plainResearch[key]),
      [false, true, true],
    );

    const text = report(
      readFileSync(join(out, "runs.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => ok(parseJsonObject(line))),
      "main",
    );
    assert.match(text, /\| notes-idor \| fm \| 1 \| 1\/1 \| 0\/1 \| 0\/1 \| 1\/1 \| 1\/1 \| 0\.300 \| 0 \|/);
    assert.match(text, /\| notes-idor \| plain \| 1 \| 0\/1 \| 1\/1 \| 1\/1 \| 0\/1 \| 0\/1 \| 0\.100 \| 0 \|/);
    assert.match(text, /\| supplement-evidence \| fm \| 1\/1 \| - \|/);
    assert.match(text, /Does Finite Monkey read the person right/);
  });
});
