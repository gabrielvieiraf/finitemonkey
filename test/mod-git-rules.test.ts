import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { gitDamageRules, MOD_GIT_GUARD } from "../src/bridge/git-rules.js";
import { modState } from "../src/bridge/state.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { createTranslator } from "../src/i18n/translate.js";
import { parseModState } from "../src/mod/state.js";
import { modeFor, ruleFor } from "../src/mod/tighten.js";
import { OPTIONAL_GUARDS, STARTS_IN_SHADOW } from "../src/policy/policy.js";
import { fmPaths } from "../src/task/paths.js";
import { fakeRuntime } from "./support.js";

const t = createTranslator("en");
const ROOT = toAbsolutePath("/work");

const loaded = (policy?: string) => {
  const files = policy === undefined ? {} : { [join(ROOT, ".finitemonkey", "policy.yml")]: policy };
  const state = modState(fakeRuntime({ files }), fmPaths(ROOT), t);
  const parsed = parseModState(JSON.stringify({ schemaVersion: 1, data: state }));
  assert.ok(parsed !== undefined);
  return parsed;
};

const idOf = (command: string): string | undefined => ruleFor(loaded(), "Bash", { command })?.rule.id;

describe("mod git damage rules", () => {
  it("names each git damage class from the command hook", () => {
    assert.equal(idOf("git push --force"), "git.force_push");
    assert.equal(idOf("git push -f origin main"), "git.force_push");
    assert.equal(idOf("git -C ../x push origin +main"), "git.force_push");
    assert.equal(idOf("git push --force-with-lease --force origin a"), "git.force_push");
    assert.equal(idOf("cd repo && git reset --hard HEAD~1"), "git.reset_hard");
    assert.equal(idOf("git clean -fdx"), "git.clean");
    assert.equal(idOf("git clean --force -d"), "git.clean");
    assert.equal(idOf("git branch -D feature"), "git.branch_force_delete");
    assert.equal(idOf("git branch --delete --force feature"), "git.branch_force_delete");
    assert.equal(idOf("git branch -d -f feature"), "git.branch_force_delete");
  });

  it("leaves the safe forms to the command hook", () => {
    for (const command of [
      "git push",
      "git push --force-with-lease=main:abc --force-if-includes",
      "git push --follow-tags",
      "git reset --soft HEAD~1",
      "git clean -n",
      "git branch -d merged",
      "git status",
      "echo git push --force-with-lease",
    ])
      assert.equal(idOf(command), undefined, command);
  });

  it("starts in shadow, so the mod records and does not deny until the person turns it on", () => {
    assert.ok(OPTIONAL_GUARDS.some((id) => id === MOD_GIT_GUARD));
    assert.equal(STARTS_IN_SHADOW.has(MOD_GIT_GUARD), true);
    const state = loaded();
    const rule = ruleFor(state, "Bash", { command: "git push --force" });
    assert.ok(rule !== undefined);
    assert.equal(rule.rule.mode, "shadow");
    assert.equal(modeFor(state.mode, rule), "shadow");
  });

  it("turned on, a git damage rule tightens as hard as the rest of the mod", () => {
    const state = loaded(`guards:\n  ${MOD_GIT_GUARD}: active\n`);
    const rule = ruleFor(state, "Bash", { command: "git push --force" });
    assert.ok(rule !== undefined);
    assert.equal(modeFor(state.mode, rule), "active");
    assert.equal(modeFor("shadow", rule), "shadow");
    assert.equal(modeFor("off", rule), "off");
  });

  it("turned off, the rules leave the state", () => {
    assert.deepEqual(gitDamageRules(t, "off"), []);
    assert.equal(
      ruleFor(loaded(`guards:\n  ${MOD_GIT_GUARD}: off\n`), "Bash", { command: "git push --force" }),
      undefined,
    );
  });
});
