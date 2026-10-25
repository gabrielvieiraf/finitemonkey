import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseYaml } from "../src/core/yaml/parse.js";
import { stringifyYaml } from "../src/core/yaml/write.js";

const SPEC_EXAMPLE = `id: 142-checkout-pix
goal: Membro paga ingresso com Pix e vê a confirmação
size: M
scope:
  paths: [src/page/checkout/**, src/api/schemas/orders.ts]
  diff_budget: { files: 15, lines: 600 }
  tests_protected: true
acceptance:
  - id: A1
    check: command
    run: pnpm check:all   # comment
  - id: A5
    check: git
    require: [committed, pushed, pr_open]
decisions_needed: []
`;

describe("yaml subset parser", () => {
  it("parses the contract example from the spec", () => {
    const parsed = parseYaml(SPEC_EXAMPLE);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      id: "142-checkout-pix",
      goal: "Membro paga ingresso com Pix e vê a confirmação",
      size: "M",
      scope: {
        paths: ["src/page/checkout/**", "src/api/schemas/orders.ts"],
        diff_budget: { files: 15, lines: 600 },
        tests_protected: true,
      },
      acceptance: [
        { id: "A1", check: "command", run: "pnpm check:all" },
        { id: "A5", check: "git", require: ["committed", "pushed", "pr_open"] },
      ],
      decisions_needed: [],
    });
  });

  const scalars = [
    ['a: "x # not a comment"', { a: "x # not a comment" }],
    ["a: 'it''s'", { a: "it's" }],
    ['a: "tab\\tand \\u00e9"', { a: "tab\tand é" }],
    ["a: ~", { a: null }],
    ["a: -3.5", { a: -3.5 }],
    ["a: 1.2.3", { a: "1.2.3" }],
    ["a:\n- x\n- y", { a: ["x", "y"] }],
    ["- a: 1\n  b: 2\n- c", [{ a: 1, b: 2 }, "c"]],
    ["a: http://x.y/z", { a: "http://x.y/z" }],
    ['"quoted key": 1', { "quoted key": 1 }],
  ] as const;
  for (const [text, value] of scalars) {
    it(`parses ${JSON.stringify(text)}`, () => {
      const parsed = parseYaml(text);
      assert.ok(parsed.ok, parsed.ok ? "" : parsed.error.message);
      assert.deepEqual(parsed.value, value);
    });
  }

  const errors = [
    ["a: 1\na: 2", 2, /duplicate key/],
    ["a:\n\tb: 1", 2, /tabs/],
    ["a: &anchor 1", 1, /unsupported/],
    ["a: [1, 2", 1, /same line/],
    ["a: 1\n---\nb: 2", 2, /one YAML document/],
    ["a: 1\n  b: 2", 2, /unexpected/],
    ['a: "open', 1, /unterminated/],
  ] as const;
  for (const [text, line, message] of errors) {
    it(`rejects ${JSON.stringify(text)} at line ${String(line)}`, () => {
      const parsed = parseYaml(text);
      assert.ok(!parsed.ok);
      assert.equal(parsed.error.line, line);
      assert.match(parsed.error.message, message);
    });
  }

  it("round-trips what the writer produces", () => {
    const value = {
      id: "t-1",
      goal: "Fix: the 'coupon' # 1",
      size: "S",
      scope: { paths: ["src/**"], tests_protected: true, budget: {} },
      acceptance: [
        { id: "C1", check: "command", run: 'node -e "process.exit(0)"' },
        { id: "tests", check: "tests" },
      ],
      decisions_needed: [],
      flags: [true, null, 3, "true", "007"],
    };
    const parsed = parseYaml(stringifyYaml(value));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, value);
  });
});
