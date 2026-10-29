import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { draftOf } from "../src/guardian/assumption-lines.js";
import { readAssumptions } from "../src/guardian/assumptions.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, denied, fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const DECISION = [
  "---",
  "schema: finitemonkey/decision@1",
  "topic: provider",
  "status: proposed",
  "---",
  "",
  "# Decision: provider",
  "",
  "## Proof",
  "",
  "ASSUMPTION: payouts settle on D+1 | impact: high | verify: read the provider changelog | trigger: file:src/billing/provider.ts",
  "ASSUMPTION: refunds are rare | impact: low",
  "",
].join("\n");

const CONTRACT = [
  "id: billing",
  "goal: move payouts",
  "scope:",
  "  paths: [src/billing/]",
  "acceptance:",
  "  - id: t",
  "    check: command",
  "    run: npm test",
  "assumptions: [a1]",
  "",
].join("\n");

const setup = (policy: string): Repo => {
  const repo = makeRepo({
    "docs/plan/02-decision-provider.md": DECISION,
    "src/billing/provider.ts": "export const provider = 1;\n",
    ".finitemonkey/tasks/billing.yml": CONTRACT,
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "billing", done: [] }),
    ".finitemonkey/policy.yml": policy,
  });
  repos.push(repo);
  return repo;
};

describe("assumption register", () => {
  it("parses impact, verification and trigger from one ASSUMPTION line", () => {
    assert.deepEqual(draftOf("cache hits stay above 40% | impact: high | trigger: date:2026-12-01"), {
      text: "cache hits stay above 40%",
      impact: "high",
      confidence: "medium",
      verify: "",
      breaks: "",
      trigger: { kind: "date", value: "2026-12-01" },
    });
  });

  it("decide check exports ASSUMPTION lines with their source, once", async () => {
    const repo = setup("level: standard\n");
    await cli(["decide", "check"], { cwd: repo.root, runtime: repoRuntime() });
    await cli(["decide", "check"], { cwd: repo.root, runtime: repoRuntime() });
    const list = readAssumptions(repoRuntime(), fmPaths(repo.root));
    assert.deepEqual(
      list.map((item) => [item.id, item.text, item.source, item.impact]),
      [
        ["a1", "payouts settle on D+1", "docs/plan/02-decision-provider.md", "high"],
        ["a2", "refunds are rare", "docs/plan/02-decision-provider.md", "low"],
      ],
    );
  });

  it("shows an unverified high-impact assumption before an irreversible step of the task that relies on it", async () => {
    const repo = setup(policyWith({ assumptions: "active" }));
    await cli(["decide", "check"], { cwd: repo.root, runtime: repoRuntime() });
    const migrate = { tool_name: "Bash", tool_input: { command: "npx prisma migrate deploy" } };
    const first = await fireHook(repo, "PreToolUse", migrate);
    assert.equal(denied(first), true);
    assert.match(contextOf(first), /a1: payouts settle on D\+1 \(verify: read the provider changelog\)/);
    assert.equal(denied(await fireHook(repo, "PreToolUse", migrate)), false);
    const harmless = await fireHook(repo, "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } });
    assert.equal(denied(harmless), false);
  });

  it("stays silent once the assumption is verified", async () => {
    const repo = setup(policyWith({ assumptions: "active" }));
    await cli(["decide", "check"], { cwd: repo.root, runtime: repoRuntime() });
    await cli(["guardian", "assume", "verify", "a1", "--evidence", "provider changelog 2026-10-20"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    const migrate = { tool_name: "Bash", tool_input: { command: "npx prisma migrate deploy" } };
    assert.equal(denied(await fireHook(repo, "PreToolUse", migrate)), false);
  });

  it("a change to the file named in the trigger marks the assumption for review", async () => {
    const repo = setup("level: standard\n");
    await cli(["decide", "check"], { cwd: repo.root, runtime: repoRuntime() });
    await cli(["guardian", "assume", "verify", "a1", "--evidence", "read it"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    repo.write("src/billing/provider.ts", "export const provider = 2;\n");
    const listed = await cli(["guardian", "assume", "list"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(listed.stdout, /a1: .*\[review/);
    assert.equal(readAssumptions(repoRuntime(), fmPaths(repo.root))[0]?.status, "review");
  });
});
