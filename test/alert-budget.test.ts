import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { checkAlertBudget } from "../src/doctor/policy.js";
import { ExitCode } from "../src/exit-codes.js";
import { parseConfigYaml } from "../src/git/project-config.js";
import { composeDecisions, type HookInput } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { catalogs } from "../src/i18n/catalogs.js";
import { LANGUAGES } from "../src/i18n/languages.js";
import { createTranslator } from "../src/i18n/translate.js";
import {
  ALERT_BUDGET_FILE,
  classRate,
  DEFAULT_ALERT_BUDGET,
  parseAlertBudget,
  readBudget,
} from "../src/policy/budget.js";
import { type GuardSet, withPolicy } from "../src/policy/guards.js";
import { parsePolicy, POLICY_FILE } from "../src/policy/policy.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => toAbsolutePath(join(ROOT, relative));
const NOW = "2026-10-26T12:00:00.000Z";
const DAY = 86_400_000;
const t = createTranslator("en");

const input = (runtime: Runtime): HookInput => {
  const parsed = parseHookPayload(
    "PreToolUse",
    JSON.stringify({ session_id: "s1", cwd: ROOT, hook_event_name: "PreToolUse", tool_name: "Bash" }),
    false,
  );
  assert.ok(parsed.ok);
  return { event: "PreToolUse", payload: parsed.value, cwd: ROOT, runtime, t, env: {} };
};

const warner: GuardSet = {
  id: "deps",
  damage: false,
  handlers: { PreToolUse: [() => ({ kind: "allow", output: { systemMessage: "finitemonkey: check this package" } })] },
};

const history = (fired: number, dismissed: number, ageDays = 1): string => {
  const stamp = Date.parse(NOW) - ageDays * DAY;
  return JSON.stringify({
    deps: {
      fired: Array.from({ length: fired }, () => stamp),
      dismissed: Array.from({ length: dismissed }, () => stamp),
    },
  });
};

const setup = (files: Readonly<Record<string, string>>) => {
  const fs = memoryFs(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
    [at(".git")],
    NOW,
  );
  return { fs, runtime: fakeRuntime({ fs }) };
};

const fire = (runtime: Runtime) => composeDecisions(input(runtime), withPolicy(warner).PreToolUse ?? []);

describe("alert budget per warning class", () => {
  it("a class with 20% dismissals over the window is muted, 10% is not", () => {
    const now = Date.parse(NOW);
    const log = (fired: number, dismissed: number) => ({
      fired: Array.from({ length: fired }, () => now - DAY),
      dismissed: Array.from({ length: dismissed }, () => now - DAY),
    });
    assert.equal(classRate("deps", log(20, 4), DEFAULT_ALERT_BUDGET, now).muted, true);
    assert.equal(classRate("deps", log(20, 2), DEFAULT_ALERT_BUDGET, now).muted, false);
    assert.equal(classRate("deps", log(5, 1), DEFAULT_ALERT_BUDGET, now).muted, false, "too few firings to judge");
  });

  it("firings and dismissals older than the window do not count", () => {
    const now = Date.parse(NOW);
    const old = now - 40 * DAY;
    const log = { fired: Array.from({ length: 20 }, () => old), dismissed: Array.from({ length: 10 }, () => old) };
    assert.deepEqual(classRate("deps", log, DEFAULT_ALERT_BUDGET, now), {
      guard: "deps",
      fired: 0,
      dismissed: 0,
      rate: 0,
      muted: false,
    });
  });

  it("thresholds come from alertBudget in policy.yml, and unknown keys there are reported", () => {
    assert.deepEqual(parseAlertBudget(parseConfigYaml("alertBudget:\n  muteAbove: 0.3\n  minFirings: 4\n")), {
      muteAbove: 0.3,
      windowDays: 30,
      minFirings: 4,
    });
    const policy = parsePolicy("alertBudget:\n  muteabove: 0.3\n");
    assert.deepEqual(policy.issues, [
      { kind: "unknown_key", file: POLICY_FILE, key: "alertBudget.muteabove", suggestion: "muteAbove" },
    ]);
  });

  it("a muted class stops warning, the firing is still counted, and the log says so", async () => {
    const { fs, runtime } = setup({ [`.finitemonkey/cache/${ALERT_BUDGET_FILE}`]: history(19, 4) });
    const decision = await fire(runtime);
    assert.deepEqual(decision, { kind: "allow", output: {} });
    assert.equal(readBudget(runtime, fmPaths(ROOT))["deps"]?.fired.length, 20);
    assert.match(fs.read(at(".finitemonkey/log.jsonl")) ?? "", /"event":"guard_muted","guard":"deps"/);
  });

  it("a class under budget keeps warning", async () => {
    const { runtime } = setup({ [`.finitemonkey/cache/${ALERT_BUDGET_FILE}`]: history(19, 1) });
    const decision = await fire(runtime);
    assert.equal(
      decision.kind === "allow" ? decision.output?.["systemMessage"] : undefined,
      "finitemonkey: check this package",
    );
  });

  it("a guard set explicitly in policy.yml is never muted", async () => {
    const { runtime } = setup({
      [POLICY_FILE]: "guards:\n  deps: active\n",
      [`.finitemonkey/cache/${ALERT_BUDGET_FILE}`]: history(19, 10),
    });
    const decision = await fire(runtime);
    assert.equal(
      decision.kind === "allow" ? decision.output?.["systemMessage"] : undefined,
      "finitemonkey: check this package",
    );
  });

  it("in shadow the budget only logs what it would mute", async () => {
    const { fs, runtime } = setup({
      [POLICY_FILE]: "guards:\n  alert-budget: shadow\n",
      [`.finitemonkey/cache/${ALERT_BUDGET_FILE}`]: history(19, 10),
    });
    const decision = await fire(runtime);
    assert.equal(
      decision.kind === "allow" ? decision.output?.["systemMessage"] : undefined,
      "finitemonkey: check this package",
    );
    assert.match(fs.read(at(".finitemonkey/log.jsonl")) ?? "", /"event":"guard_mute_shadow"/);
  });

  it("a recorded false positive counts as a dismissal and doctor names the muted class", async () => {
    const { runtime } = setup({ [`.finitemonkey/cache/${ALERT_BUDGET_FILE}`]: history(20, 3) });
    const recorded = await cliJson(["policy", "false-positive", "deps"], {
      cwd: ROOT,
      runtime,
      stdin: Object.assign(stdinFrom(""), { isTTY: true }),
    });
    assert.equal(recorded.code, ExitCode.Ok);
    assert.equal(readBudget(runtime, fmPaths(ROOT))["deps"]?.dismissed.length, 4);
    const [row] = checkAlertBudget({ platform: "linux", env: {}, cwd: ROOT, root: ROOT, version: "x", runtime });
    assert.ok(row);
    assert.equal(row.status, "warn");
    assert.match(String(row.params?.["list"]), /deps \(4\/20\)/);
  });
});

describe("every guard message carries the next action", () => {
  const ACTION = /`[^`]+`|finitemonkey: (?:allow|approve|trust)|fm: allow|\bfinitemonkey [a-z-]+ [a-z-]+/;
  for (const lang of LANGUAGES) {
    it(`every person-facing guard line in ${lang} names what to do next`, () => {
      const catalog = catalogs[lang];
      const label = catalog["guard.next"];
      const missing = Object.entries(catalog)
        .filter(([key]) => key.endsWith(".human"))
        .filter(([, text]) => !ACTION.test(text) && !text.includes(label))
        .map(([key]) => key);
      assert.deepEqual(missing, []);
    });
  }
});
