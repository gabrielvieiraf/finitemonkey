import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { auditText, WORKFLOWS_DIR } from "../src/ci/audit/audit.js";
import { ROOT } from "./support.js";

const workflows = (): readonly string[] =>
  readdirSync(join(ROOT, ...WORKFLOWS_DIR.split("/")))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();

const findingsAt = (level: 1): readonly string[] =>
  workflows().flatMap((name) => {
    const file = `${WORKFLOWS_DIR}/${name}`;
    const text = readFileSync(join(ROOT, ...file.split("/")), "utf8");
    return auditText(file, text, level, true).map((item) => `${item.file}:${String(item.line)} ${item.rule}`);
  });

describe("the workflows of this repository", () => {
  it("pass ci audit with no finding at the project's level", () => {
    assert.ok(workflows().length > 0);
    assert.deepEqual(findingsAt(1), []);
  });

  it("the CI runs the supply-chain job on pull requests", () => {
    const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const job = ci.slice(ci.indexOf("\n  supply-chain:"), ci.indexOf("\n  budgets:"));
    assert.match(ci, /^ {2}pull_request:$/m);
    assert.doesNotMatch(job, /^ {4}if:/m);
    for (const step of ["deps check", "ci audit --json", "deps scan", "sha256sum -c -"])
      assert.match(job, new RegExp(step));
  });
});
