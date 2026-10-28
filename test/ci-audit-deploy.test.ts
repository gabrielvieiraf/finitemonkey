import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditWorkflow } from "../src/ci/audit/rules.js";
import { parseWorkflow } from "../src/ci/audit/workflow.js";

describe("ci audit: jobs inside a deploy workflow", () => {
  const text = (deployEnvironment: string) =>
    [
      "name: deploy",
      "on:",
      "  push:",
      "    branches: [main]",
      "permissions: {}",
      "concurrency:",
      "  group: deploy",
      "  cancel-in-progress: false",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10",
      "    steps:",
      "      - run: npm test",
      "  release:",
      "    needs: check",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10",
      ...deployEnvironment.split("\n").filter((line) => line !== ""),
      "    steps:",
      "      - run: ./ship.sh",
      "",
    ].join("\n");

  const rulesFor = (deployEnvironment: string): readonly string[] => {
    const parsed = parseWorkflow("deploy.yml", text(deployEnvironment));
    assert.ok(parsed.ok);
    return auditWorkflow(parsed.value, { level: 3, publicRepo: true }).map((hit) => `${hit.job}:${hit.rule}`);
  };

  it("a job other jobs need is a prerequisite, not a deploy", () => {
    assert.ok(!rulesFor("    environment: production").some((item) => item.startsWith("check:")));
  });

  it("the job that ships still needs an environment", () => {
    assert.deepEqual(rulesFor(""), ["release:deploy-unsafe"]);
    assert.deepEqual(rulesFor("    environment: production"), []);
  });
});
