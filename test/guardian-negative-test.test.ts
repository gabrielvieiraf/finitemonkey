import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { negativeTestFor } from "../src/guardian/negative-test.js";
import { parseContract } from "../src/task/load.js";
import { tty } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const CONTRACT = [
  "id: coupons",
  "goal: apply coupons at checkout",
  "scope:",
  "  paths: [src/]",
  "acceptance:",
  "  - id: coupon-math",
  "    check: command",
  "    run: npm test",
  "",
].join("\n");

const setup = (): Repo => {
  const repo = makeRepo({
    ".finitemonkey/tasks/coupons.yml": CONTRACT,
    ".finitemonkey/state.json": JSON.stringify({ schemaVersion: 1, active: "coupons", done: [] }),
    "src/coupon.ts": "export const apply = (total: number): number => total;\n",
  });
  repos.push(repo);
  return repo;
};

const PREMISE = "an expired coupon is rejected | impact: high | verify: behavior";

describe("negative tests for behavior premises", () => {
  it("proposes no test for a premise that is not verified by behavior", () => {
    const item = {
      id: "a1",
      text: "payouts settle on D+1",
      source: "manual",
      impact: "high",
      breaks: "",
      confidence: "medium",
      verify: "read the changelog",
      status: "unverified",
      at: "2026-10-01T00:00:00.000Z",
    } as const;
    assert.equal(negativeTestFor(item, undefined), undefined);
  });

  it("writes the import line each runner expects", () => {
    const item = {
      id: "a2",
      text: "an empty cart cannot check out",
      source: "manual",
      impact: "high",
      breaks: "",
      confidence: "medium",
      verify: "behavior",
      status: "unverified",
      at: "2026-10-01T00:00:00.000Z",
    } as const;
    const skeleton = (run: string): string => {
      const parsed = parseContract("coupons", CONTRACT.replace("coupon-math", "cart").replace("npm test", run));
      return parsed.ok ? (negativeTestFor(item, parsed.value)?.skeleton ?? "") : "";
    };
    assert.match(skeleton("npx vitest run"), /^import \{ it \} from "vitest";\n\nit\("cart: /);
    assert.match(skeleton("npm test"), /^import \{ it \} from "node:test";\n/);
    assert.match(skeleton("npx jest"), /^it\("cart: /);
  });

  it("a behavior premise gets a negative test proposal naming the criterion, and nothing is written", async () => {
    const repo = setup();
    const added = await cliJson(["guardian", "assume", "add", PREMISE], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(added.code, 0, added.stdout);
    const proposals = field(added.body, "data", "proposals");
    const proposal: unknown = Array.isArray(proposals) ? proposals[0] : undefined;
    assert.equal(field(proposal, "criterion"), "coupon-math");
    assert.equal(field(proposal, "run"), "npm test");
    assert.equal(field(proposal, "file"), "test/an-expired-coupon-is-rejected.negative.test.ts");
    assert.match(String(field(proposal, "skeleton")), /coupon-math: fails when the premise does not hold/);
    assert.equal(existsSync(join(repo.root, "test/an-expired-coupon-is-rejected.negative.test.ts")), false);
    const shown = await cli(["guardian", "assume", "test", "a1"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(shown.stdout, /criterion coupon-math/);
    assert.match(shown.stdout, /Nothing was written/);
  });

  it("only a person writes the proposed test, and never over an existing file", async () => {
    const repo = setup();
    await cli(["guardian", "assume", "add", PREMISE], { cwd: repo.root, runtime: repoRuntime() });
    const file = join(repo.root, "test/an-expired-coupon-is-rejected.negative.test.ts");
    const agent = await cliJson(["guardian", "assume", "test", "a1", "--write"], {
      cwd: repo.root,
      env: { CLAUDECODE: "1" },
      stdin: tty(),
      runtime: repoRuntime(),
    });
    assert.notEqual(agent.code, 0);
    assert.equal(existsSync(file), false);
    const person = await cliJson(["guardian", "assume", "test", "a1", "--write"], {
      cwd: repo.root,
      stdin: tty(),
      runtime: repoRuntime(),
    });
    assert.equal(person.code, 0, person.stdout);
    assert.equal(field(person.body, "data", "written"), true);
    assert.match(repo.read("test/an-expired-coupon-is-rejected.negative.test.ts"), /throw new Error/);
    const again = await cliJson(["guardian", "assume", "test", "a1", "--write"], {
      cwd: repo.root,
      stdin: tty(),
      runtime: repoRuntime(),
    });
    assert.notEqual(again.code, 0);
  });
});
