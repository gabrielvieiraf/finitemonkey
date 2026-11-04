import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeExec } from "../src/core/node-exec.js";
import type { Runtime } from "../src/core/runtime.js";
import type { HookEvent } from "../src/hooks/events.js";
import { composeDecisions, type HookHandler, type HookInput } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { withPolicy } from "../src/policy/guards.js";
import { POLICY_FILE } from "../src/policy/policy.js";
import { EARLY_GUARD, earlyLoopTriggers, SYNTAX_GUARD, syntaxAfterEdit } from "../src/signals/early.js";
import { signalsPostToolUse } from "../src/signals/record.js";
import { syntaxProblem } from "../src/signals/syntax.js";
import { nodeModuleCheck, packageIsModule, projectTypescript } from "../src/signals/syntax-tools.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime, ROOT as REPO } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const t = createTranslator("en");
const moduleCheck = nodeModuleCheck({ exec: nodeExec }, toAbsolutePath(REPO));

describe("syntax of ES modules and TypeScript without Node type stripping", () => {
  it("an ES module .js file with a syntax error is reported with its line", () => {
    const broken = 'import x from "y";\nconst b = ;\nexport { b };\n';
    const problem = syntaxProblem("src/a.js", broken, { esm: true, module: moduleCheck });
    assert.equal(problem?.line, 2);
    assert.match(problem.message, /Unexpected token/);
    assert.equal(
      syntaxProblem("src/a.js", 'import x from "y";\nexport const b = x;\n', { esm: true, module: moduleCheck }),
      undefined,
    );
    assert.equal(syntaxProblem("src/a.mjs", "export const = 1;\n", { module: moduleCheck })?.line, 1);
  });

  it("a .js file is parsed as a module only when package.json says type module", () => {
    const fs = memoryFs(
      {
        [at("package.json")]: '{"type":"module"}',
        [at("legacy/package.json")]: '{"type":"commonjs"}',
      },
      [],
      "2026-10-26T12:00:00.000Z",
    );
    const runtime = fakeRuntime({ fs });
    assert.equal(packageIsModule(runtime, ROOT, "src/a.js"), true);
    assert.equal(packageIsModule(runtime, ROOT, "legacy/b.js"), false);
    assert.equal(
      packageIsModule(fakeRuntime({ fs: memoryFs({}, [], "2026-10-26T12:00:00.000Z") }), ROOT, "a.js"),
      false,
    );
  });

  it("TypeScript falls back to the project's typescript package when Node cannot strip types", () => {
    const typescript = projectTypescript(REPO);
    const problem = syntaxProblem("a.ts", "const a = 1;\nconst b: number = ;\n", { typescript });
    assert.equal(problem?.line, 2);
    assert.ok(problem.message.length > 0);
    assert.equal(syntaxProblem("a.ts", "const b: number = 2;\n", { typescript }), undefined);
    assert.equal(syntaxProblem("a.ts", "const b: number = ;\n", { typescript: projectTypescript(ROOT) }), undefined);
  });
});

const inputOf = (runtime: Runtime, event: HookEvent, raw: Readonly<Record<string, unknown>>): HookInput => {
  const body = JSON.stringify({ session_id: "s1", cwd: ROOT, hook_event_name: event, ...raw });
  const parsed = parseHookPayload(event, body, false);
  assert.ok(parsed.ok);
  return { event, payload: parsed.value, cwd: ROOT, runtime, t, env: {} };
};

const guarded = (id: string, handler: HookHandler): readonly HookHandler[] =>
  withPolicy({ id, damage: false, handlers: { PostToolUse: [handler] } }).PostToolUse ?? [];

describe("the edit loop trigger with syntax-check active", () => {
  it("the third edit that leaves the file broken fires failed_edits at exactly 3", async () => {
    const fs = memoryFs(
      {
        [at(POLICY_FILE)]: "guards:\n  syntax-check: active\n  early-loops: active\n",
        [at("data.json")]: '{"a": ,}',
      },
      [at(".git"), at(".fm")],
      "2026-10-26T12:00:00.000Z",
    );
    const runtime = fakeRuntime({ fs });
    const chain = [...guarded(SYNTAX_GUARD, syntaxAfterEdit), ...guarded(EARLY_GUARD, earlyLoopTriggers)];
    const raw = { tool_name: "Write", tool_input: { file_path: at("data.json"), content: "x" }, tool_response: {} };
    const once = async (): Promise<string> => {
      await signalsPostToolUse(inputOf(runtime, "PostToolUse", raw));
      const decision = await composeDecisions(inputOf(runtime, "PostToolUse", raw), chain);
      return decision.kind === "block" ? decision.reason : "";
    };
    const reasons = [await once(), await once(), await once(), await once()];
    assert.ok(reasons.every((reason) => reason.includes("data.json does not parse after this edit")));
    assert.deepEqual(
      reasons.map((reason) => reason.includes("failed edits in a row on data.json")),
      [false, false, true, false],
    );
    assert.match(reasons[2] ?? "", /3 failed edits in a row on data\.json/);
  });
});
