import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import type { HookEvent } from "../src/hooks/events.js";
import type { HookInput } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { learningsInject } from "../src/learnings/hooks.js";
import { learnFromSignatures } from "../src/learnings/learn.js";
import { readLessons } from "../src/learnings/store.js";
import { lessonTree } from "../src/learnings/tree.js";
import { errorSignature } from "../src/signals/signature.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const t = createTranslator("en");
const NOW = "2026-10-26T12:00:00.000Z";
const ERROR = "TypeError: Cannot read properties of undefined (reading 'total') at charge (src/a.ts:3:10)";
const SIG = errorSignature(ERROR)?.sig ?? "";

const signals = [
  { at: NOW, session: "s1", turn: 1, kind: "error", sig: SIG, sample: ERROR, tool: "Bash" },
  { at: NOW, session: "s1", turn: 1, kind: "error", sig: SIG, sample: ERROR, tool: "Bash" },
  { at: NOW, session: "s1", turn: 1, kind: "edit", file: "src/a.ts", hash: "1", undo: false },
  { at: NOW, session: "s1", turn: 1, kind: "edit", file: "src/b.ts", hash: "2", undo: false },
]
  .map((entry) => JSON.stringify(entry))
  .join("\n");

const inputOf = (runtime: Runtime, event: HookEvent, raw: Readonly<Record<string, unknown>>): HookInput => {
  const parsed = parseHookPayload(
    event,
    JSON.stringify({ session_id: "s1", cwd: ROOT, hook_event_name: event, ...raw }),
    false,
  );
  assert.ok(parsed.ok);
  return { event, payload: parsed.value, cwd: ROOT, runtime, t, env: {} };
};

const project = () => {
  const fs = memoryFs(
    {
      [at(".fm/signals.jsonl")]: `${signals}\n`,
      [at(".fm/policy.yml")]: "guards:\n  learnings: active\n",
      [at("src/a.ts")]: "export const charge = (order) => order.total;\n",
      [at("src/b.ts")]: "export const b = 1;\n",
    },
    [at(".git"), at(".fm"), at(".fm/cache"), at("src")],
    NOW,
  );
  return { fs, runtime: fakeRuntime({ fs }) };
};

const injected = async (runtime: Runtime): Promise<boolean> => {
  const decision = await learningsInject(
    inputOf(runtime, "PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "npm test" }, error: ERROR }),
  );
  return decision.kind === "allow" && JSON.stringify(decision.output ?? {}).includes("finitemonkey lessons");
};

describe("lessons carry the tree of the files they name", () => {
  it("a lesson whose file changed is not injected until the person confirms it", async () => {
    const { runtime } = project();
    const [lesson] = learnFromSignatures(inputOf(runtime, "Stop", {}), fmPaths(ROOT));
    assert.ok(lesson?.tree);
    assert.equal(lesson.tree, lessonTree(runtime, ROOT, ["src/a.ts", "src/b.ts"]));
    assert.equal(await injected(runtime), true);

    runtime.writeText(toAbsolutePath(at("src/a.ts")), "export const charge = (order) => order?.total ?? 0;\n");
    assert.equal(await injected(runtime), false);
    const [stale] = readLessons(runtime, fmPaths(ROOT).dir);
    assert.equal(stale?.stale, true);

    const listed = await cliJson(["learnings"], { cwd: ROOT, runtime });
    assert.match(listed.stdout, /"stale":true/);

    const byAgent = await cliJson(["learnings", "accept", lesson.id], { cwd: ROOT, runtime });
    assert.notEqual(byAgent.code, 0);
    assert.equal(await injected(runtime), false);

    const accepted = await cliJson(["learnings", "accept", lesson.id], {
      cwd: ROOT,
      runtime,
      stdin: Object.assign(stdinFrom(""), { isTTY: true }),
    });
    assert.equal(accepted.code, 0);
    const [after] = readLessons(runtime, fmPaths(ROOT).dir);
    assert.equal(after?.stale, undefined);
    assert.equal(after?.tree, lessonTree(runtime, ROOT, ["src/a.ts", "src/b.ts"]));
    assert.equal(await injected(runtime), true);
  });

  it("a lesson keyed only by globs carries no tree and is never marked stale", () => {
    const { runtime } = project();
    assert.equal(lessonTree(runtime, ROOT, ["src/**"]), undefined);
  });
});
