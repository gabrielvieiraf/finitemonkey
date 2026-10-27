import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { ExitCode } from "../src/exit-codes.js";
import { composeDecisions, DEFAULT_HANDLERS, GUARD_SETS, type HookInput } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { type GuardSet, modeOf, withPolicy } from "../src/policy/guards.js";
import { DEFAULT_POLICY, parsePolicy, POLICY_FILE } from "../src/policy/policy.js";
import { memoryFs } from "./memory-fs.js";
import { SAMPLES } from "./secret-samples.js";
import { cliJson, fakeRuntime, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const t = createTranslator("en");

const payloadOf = (raw: Readonly<Record<string, unknown>>) => {
  const parsed = parseHookPayload(
    "PreToolUse",
    JSON.stringify({ session_id: "s1", cwd: ROOT, hook_event_name: "PreToolUse", ...raw }),
    false,
  );
  assert.ok(parsed.ok);
  return parsed.value;
};

const inputWith = (runtime: Runtime, raw: Readonly<Record<string, unknown>> = {}): HookInput => ({
  event: "PreToolUse",
  payload: payloadOf(raw),
  cwd: ROOT,
  runtime,
  t,
  env: {},
});

const blocker: GuardSet = {
  id: "demo",
  damage: false,
  handlers: { PreToolUse: [() => ({ kind: "block", reason: "demo would block" })] },
};

const setup = (policy?: string) => {
  const fs = memoryFs(policy === undefined ? {} : { [at(POLICY_FILE)]: policy }, [at(".git")]);
  return { fs, runtime: fakeRuntime({ fs }) };
};

const events = (fs: ReturnType<typeof memoryFs>): readonly Readonly<Record<string, unknown>>[] =>
  (fs.read(at(".finitemonkey/log.jsonl")) ?? "")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      assert.ok(typeof parsed === "object" && parsed !== null);
      return parsed as Readonly<Record<string, unknown>>;
    });

const run = (runtime: Runtime) =>
  composeDecisions(inputWith(runtime, { tool_name: "Bash" }), withPolicy(blocker).PreToolUse ?? []);

describe("guard modes from .finitemonkey/policy.yml", () => {
  it("parses modes, level, severity and promoteAfter, ignoring unknown modes", () => {
    const policy = parsePolicy(
      "level: strict\nseverity: high\npromoteAfter: 5\nguards:\n  prose: shadow\n  demo: maybe\n",
    );
    assert.deepEqual(policy, {
      exists: true,
      level: "strict",
      severity: "high",
      promoteAfter: 5,
      guards: { prose: "shadow" },
    });
  });

  it("without a policy file every guard is active", async () => {
    const { runtime } = setup();
    assert.equal((await run(runtime)).kind, "block");
  });

  it("off skips the guard and active blocks", async () => {
    assert.equal((await run(setup("guards:\n  demo: off\n").runtime)).kind, "allow");
    assert.equal((await run(setup("guards:\n  demo: active\n").runtime)).kind, "block");
  });

  it("a guard missing from an existing policy runs in shadow and logs what it would have done", async () => {
    const { fs, runtime } = setup("guards:\n  prose: active\n");
    assert.equal((await run(runtime)).kind, "allow");
    const [shadow] = events(fs);
    assert.ok(shadow);
    assert.deepEqual(
      [shadow["event"], shadow["guard"], shadow["wouldHave"], shadow["reason"], shadow["tool"]],
      ["guard_shadow", "demo", "block", "demo would block", "Bash"],
    );
  });

  it("is promoted after promoteAfter firings with no false positive, and the log keeps the counts", async () => {
    const { fs, runtime } = setup("promoteAfter: 2\nguards:\n  prose: active\n");
    assert.equal((await run(runtime)).kind, "allow");
    assert.equal((await run(runtime)).kind, "allow");
    const promoted = events(fs).find((event) => event["event"] === "guard_promoted");
    assert.deepEqual(
      {
        firings: promoted?.["firings"],
        falsePositives: promoted?.["falsePositives"],
        promoteAfter: promoted?.["promoteAfter"],
      },
      { firings: 2, falsePositives: 0, promoteAfter: 2 },
    );
    assert.equal((await run(runtime)).kind, "block");
  });

  it("a recorded false positive keeps the guard in shadow", async () => {
    const { fs, runtime } = setup("promoteAfter: 1\nguards:\n  prose: active\n");
    fs.writeAtomic(toAbsolutePath(at(".finitemonkey/cache/shadow.json")), '{"demo":{"firings":0,"falsePositives":1}}');
    assert.equal((await run(runtime)).kind, "allow");
    assert.equal((await run(runtime)).kind, "allow");
    assert.equal(events(fs).filter((event) => event["event"] === "guard_promoted").length, 0);
  });
});

describe("the four-damage guards ignore off", () => {
  it("modeOf keeps them active whatever the policy says", () => {
    const policy = parsePolicy("guards:\n  secrets: off\n  gate: off\n  git: shadow\n");
    for (const set of GUARD_SETS.filter((guard) => guard.damage)) {
      assert.equal(modeOf(set, policy, {}), "active", set.id);
    }
    assert.deepEqual(
      GUARD_SETS.filter((guard) => guard.damage).map((guard) => guard.id),
      ["secrets", "gate", "git", "rules"],
    );
    assert.equal(modeOf({ id: "prose", damage: false }, DEFAULT_POLICY, {}), "active");
  });

  it("a secret write and a skipped test still block with every guard set to off", async () => {
    const testFile = at("src/cart.test.ts");
    const fs = memoryFs(
      {
        [at(POLICY_FILE)]: "guards:\n  secrets: off\n  gate: off\n  git: off\n  prose: off\n",
        [testFile]: 'it("a", () => { expect(1).toBe(1); });\n',
      },
      [at(".git")],
    );
    const runtime = fakeRuntime({ fs });
    const decide = (raw: Readonly<Record<string, unknown>>) =>
      composeDecisions(inputWith(runtime, raw), DEFAULT_HANDLERS.PreToolUse ?? []);
    const skip = await decide({
      tool_name: "Edit",
      tool_input: { file_path: testFile, old_string: 'it("a"', new_string: 'it.skip("a"' },
    });
    assert.equal(skip.kind, "block");
    const secret = await decide({
      tool_name: "Write",
      tool_input: { file_path: at("src/config.ts"), content: `export const key = "${SAMPLES.githubPat}";\n` },
    });
    assert.equal(secret.kind, "block");
  });
});

describe("policy false-positive", () => {
  it("only the person can record one", async () => {
    const result = await cliJson(["policy", "false-positive", "prose"], { cwd: ROOT, runtime: setup().runtime });
    assert.equal(result.code, ExitCode.NeedsPerson);
  });

  it("from the person's terminal it counts the false positive for that guard", async () => {
    const { fs, runtime } = setup("guards:\n  prose: active\n");
    const result = await cliJson(["policy", "false-positive", "prose"], {
      cwd: ROOT,
      runtime,
      stdin: Object.assign(stdinFrom(""), { isTTY: true }),
    });
    assert.equal(result.code, ExitCode.Ok);
    assert.match(fs.read(at(".finitemonkey/cache/shadow.json")) ?? "", /"falsePositives": 1/);
  });
});
