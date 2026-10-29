import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MOD_TIGHTEN_GUARD, modState } from "../src/bridge/state.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { createTranslator } from "../src/i18n/translate.js";
import { MOD_STATE_SCHEMA, parseModState } from "../src/mod/state.js";
import { type CheckResult, type Decision, relativeTo, ruleFor, stricter, tightenFor } from "../src/mod/tighten.js";
import { OPTIONAL_GUARDS, STARTS_IN_SHADOW } from "../src/policy/policy.js";
import { fmPaths } from "../src/task/paths.js";
import { fakeRuntime } from "./support.js";

const t = createTranslator("en");

const DECISIONS: readonly Decision[] = ["allow", "ask", "deny"];
const RANK: Readonly<Record<Decision, number>> = { allow: 0, ask: 1, deny: 2 };
const ROOT = toAbsolutePath("/work");

const loaded = () => {
  const state = modState(fakeRuntime({}), fmPaths(ROOT), t);
  const parsed = parseModState(JSON.stringify({ schemaVersion: 1, data: state }));
  assert.ok(parsed !== undefined);
  return parsed;
};

describe("mod tightening", () => {
  it("never loosens and never answers allow on its own, for every pair of decisions", () => {
    for (const before of DECISIONS) {
      for (const tightened of DECISIONS.filter((decision) => decision !== "allow")) {
        const decided: CheckResult = { decision: before, reason: "chain" };
        const result = stricter(decided, { decision: tightened, reason: "mod" });
        assert.ok(RANK[result.decision] >= RANK[before]);
        assert.notEqual(result.decision === "allow" && before !== "allow", true);
      }
    }
  });

  it("a rule always tightens to deny", () => {
    for (const rule of loaded().rules) assert.equal(tightenFor(rule).decision, "deny");
  });

  it("the CLI state protects the evidence and leaves front reports alone", () => {
    const state = loaded();
    assert.equal(state.mode, "active");
    assert.equal(
      ruleFor(state, "Write", { file_path: "/work/.finitemonkey/evidence/t1.jsonl" })?.rule.id,
      "self.policy",
    );
    assert.equal(ruleFor(state, "Write", { file_path: "/work/.finitemonkey/reports/front.json" }), undefined);
    assert.equal(
      ruleFor(state, "Edit", { file_path: "/work/.git/finitemonkey/worktrees.yml" })?.rule.id,
      "self.registry",
    );
    assert.equal(ruleFor(state, "Write", { file_path: "/work/src/a.ts" }), undefined);
    assert.equal(ruleFor(state, "Read", { file_path: "/work/.finitemonkey/state.json" }), undefined);
    assert.equal(ruleFor(state, "Bash", { command: "git commit -m x --no-verify" })?.rule.id, "bypass.no_verify");
    assert.equal(ruleFor(state, "Bash", { command: "echo hi > .finitemonkey/state.json" })?.rule.id, "self.shell");
    assert.equal(ruleFor(state, "Bash", { command: "cat .finitemonkey/state.json" }), undefined);
  });

  it("relative paths work for POSIX and Windows roots", () => {
    assert.equal(relativeTo("/work", "/work/src/a.ts"), "src/a.ts");
    assert.equal(relativeTo("C:\\work", "c:\\work\\src\\a.ts"), "src/a.ts");
    assert.equal(relativeTo("/work", "./src/a.ts"), "src/a.ts");
  });

  it("the state is a named payload and the guard starts active as a repeat of damage guards", () => {
    assert.equal(loaded().rules.length > 0, true);
    assert.equal(modState(fakeRuntime({}), fmPaths(ROOT), t).schema, MOD_STATE_SCHEMA);
    assert.ok(OPTIONAL_GUARDS.some((id) => id === MOD_TIGHTEN_GUARD));
    assert.equal(STARTS_IN_SHADOW.has(MOD_TIGHTEN_GUARD), false);
  });

  it("an unreadable state loads nothing, so the mod does not tighten from a guess", () => {
    assert.equal(parseModState("not json"), undefined);
    assert.equal(parseModState(JSON.stringify({ schema: "other@1", root: "/w", rules: [] })), undefined);
  });
});
