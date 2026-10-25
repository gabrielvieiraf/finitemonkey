import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTrivialCommand } from "../src/gate/checks/command.js";
import { parseTestSummary } from "../src/gate/test-summary.js";

describe("test runner summaries", () => {
  const outputs = [
    {
      runner: "node:test spec",
      text: "✔ adds (1ms)\n✖ keeps (2ms)\nℹ tests 2\nℹ pass 1\nℹ fail 1\n✖ failing tests:\n✖ keeps (2ms)",
      total: 2,
      failures: ["keeps"],
    },
    {
      runner: "node:test tap",
      text: "ok 1 - adds\nnot ok 2 - keeps\n# tests 2\n# pass 1\n# fail 1",
      total: 2,
      failures: ["keeps"],
    },
    {
      runner: "vitest",
      text: " FAIL  src/cart.test.ts > cart > applies\n Test Files  1 failed (1)\n      Tests  1 failed | 4 passed (5)",
      total: 5,
      failures: ["src/cart.test.ts > cart > applies"],
    },
    {
      runner: "jest",
      text: "  ● cart › applies\nTests:       1 failed, 4 passed, 5 total",
      total: 5,
      failures: ["cart › applies"],
    },
    {
      runner: "pytest",
      text: "FAILED tests/test_cart.py::test_applies - assert 1 == 2\n========= 1 failed, 4 passed in 0.12s =========",
      total: 5,
      failures: ["tests/test_cart.py::test_applies"],
    },
    {
      runner: "go test",
      text: "--- FAIL: TestApplies (0.00s)\nFAIL\nFAIL\texample.com/cart\t0.01s",
      total: undefined,
      failures: ["TestApplies"],
    },
    { runner: "vitest zero", text: "No test files found, exiting with code 0", total: 0, failures: [] },
    { runner: "jest zero", text: "No tests found, exiting with code 0", total: 0, failures: [] },
    { runner: "pytest zero", text: "========= no tests ran in 0.01s =========", total: 0, failures: [] },
    { runner: "go zero", text: "?   \texample.com/cart\t[no test files]", total: 0, failures: [] },
    { runner: "colors", text: "\u001b[32mℹ tests 3\u001b[39m", total: 3, failures: [] },
  ] as const;
  for (const { runner, text, total, failures } of outputs) {
    it(`reads ${runner}`, () => {
      const summary = parseTestSummary(text);
      assert.equal(summary.total, total);
      assert.deepEqual(summary.failures, failures);
    });
  }
});

describe("trivial commands are not evidence", () => {
  const cases = [
    ["echo ok", true],
    ["true && echo done", true],
    ["exit 0", true],
    [":", true],
    ["", true],
    ["pnpm test", false],
    ["echo start && npm test", false],
    ["CI=1 node --test", false],
  ] as const;
  for (const [command, trivial] of cases) {
    it(`${JSON.stringify(command)} is ${trivial ? "" : "not "}trivial`, () => {
      assert.equal(isTrivialCommand(command), trivial);
    });
  }
});
