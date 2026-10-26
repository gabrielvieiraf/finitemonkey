import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "./support.js";

const workflow = readFileSync(join(ROOT, ".github", "workflows", "claude-latest.yml"), "utf8");
const e2e = readFileSync(join(ROOT, "test", "e2e", "claude-stop.e2e.ts"), "utf8");

const STOP_CASES = [
  "Stop blocks once through the plugin",
  "Stop blocks once through project settings",
  "Stop blocks once through project settings with the plugin disabled",
];

describe("weekly run against the latest Claude Code", () => {
  it("runs every week and on demand", () => {
    assert.match(workflow, /schedule:\n\s+- cron: "[^"]+"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /@anthropic-ai\/claude-code@latest/);
    assert.match(workflow, /claude --version/);
    assert.match(workflow, /scripts\/claude-surface\.mjs/);
  });

  it("the three Stop integration cases are separate test names", () => {
    for (const name of STOP_CASES) assert.ok(e2e.includes(`it("${name}"`), name);
    assert.equal(new Set(STOP_CASES).size, STOP_CASES.length);
  });

  it("reads the API key from a secret in one step and never prints it", () => {
    assert.equal(workflow.match(/secrets\.ANTHROPIC_API_KEY/g)?.length, 1);
    assert.doesNotMatch(workflow, /echo[^\n]*\$\{?ANTHROPIC_API_KEY/);
    assert.doesNotMatch(workflow, /set -x/);
    assert.doesNotMatch(e2e, /console\.|process\.stdout|ANTHROPIC_API_KEY/);
  });

  it("asks for the least permissions: read by default, issues only in the reporting job", () => {
    assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
    assert.equal(workflow.match(/issues: write/g)?.length, 1);
    assert.doesNotMatch(workflow, /contents: write|pull-requests: write|id-token: write/);
    assert.match(workflow, /persist-credentials: false/);
  });

  it("a failing week updates one open issue instead of opening another", () => {
    assert.match(workflow, /if: failure\(\) && github\.event_name == 'schedule'/);
    assert.match(workflow, /gh issue list --state open/);
    assert.match(workflow, /gh issue comment "\$number"/);
    assert.match(workflow, /gh issue create --title "\$title"/);
  });
});
