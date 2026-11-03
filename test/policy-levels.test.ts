import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveGuard } from "../src/policy/guards.js";
import { ACTIVE_AT_STANDARD, levelMode } from "../src/policy/levels.js";
import { DEFAULT_POLICY, type Level, parsePolicy, STARTS_IN_SHADOW } from "../src/policy/policy.js";
import { featureDefaults } from "../src/stale/state.js";

const at = (level: Level) => ({ ...DEFAULT_POLICY, level });
const resolve = (id: string, level: Level, promoted = false) =>
  resolveGuard(
    { id, damage: false },
    at(level),
    promoted ? { [id]: { firings: 20, falsePositives: 0, promoted: true } } : {},
  );

describe("levels: which new features act without a policy file", () => {
  it("the default level is standard", () => {
    assert.equal(DEFAULT_POLICY.level, "standard");
    assert.equal(parsePolicy("").level, "standard");
    assert.equal(parsePolicy("level: light\n").level, "light");
  });

  it("only lists features that start in shadow", () => {
    for (const id of ACTIVE_AT_STANDARD) assert.ok(STARTS_IN_SHADOW.has(id), id);
  });

  it("levelMode: light keeps every feature in shadow, standard activates its list, strict activates all", () => {
    assert.equal(levelMode("quality", "light"), "shadow");
    assert.equal(levelMode("quality", "standard"), "active");
    assert.equal(levelMode("quality", "strict"), "active");
    assert.equal(levelMode("reminders", "light"), "shadow");
    assert.equal(levelMode("reminders", "standard"), "shadow");
    assert.equal(levelMode("reminders", "strict"), "active");
  });

  it("standard resolves a listed feature active from the level and leaves the rest in shadow", () => {
    assert.deepEqual(resolve("secret-context", "standard"), { mode: "active", source: "level", ignored: [] });
    assert.deepEqual(resolve("reminders", "standard"), { mode: "shadow", source: "default", ignored: [] });
  });

  it("strict resolves every new feature active from the level", () => {
    assert.deepEqual(resolve("reminders", "strict"), { mode: "active", source: "level", ignored: [] });
  });

  it("light keeps the old rule: shadow until promoted", () => {
    assert.deepEqual(resolve("quality", "light"), { mode: "shadow", source: "default", ignored: [] });
    assert.deepEqual(resolve("quality", "light", true), { mode: "active", source: "promoted", ignored: [] });
  });

  it("a feature outside the shadow list stays active by default at every level", () => {
    for (const level of ["light", "standard", "strict"] as const)
      assert.deepEqual(resolve("secrets", level), { mode: "active", source: "default", ignored: [] });
  });

  it("a mode in policy.yml wins over the level", () => {
    const light = parsePolicy("level: light\nguards:\n  reminders: active\n");
    assert.equal(resolveGuard({ id: "reminders", damage: false }, light, {}).mode, "active");
    const standard = parsePolicy("guards:\n  quality: shadow\n");
    assert.equal(resolveGuard({ id: "quality", damage: false }, standard, {}).mode, "shadow");
  });

  it("the stale report lists the defaults of the standard level", () => {
    const defaults = featureDefaults();
    assert.equal(defaults.get("quality"), "active");
    assert.equal(defaults.get("reminders"), "shadow");
    assert.equal(defaults.get("secrets"), "active");
  });
});
