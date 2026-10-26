import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareConfig, compareNewTestFile, compareTestFile, configDigest } from "../src/guards/tests/analyze.js";
import { isProtectedConfig, testLanguage } from "../src/guards/tests/patterns.js";
import { countTests } from "../src/guards/tests/scan.js";
import { analyzeTree } from "../src/guards/tests/tree.js";

const JS_BEFORE = `import { describe, expect, it } from "vitest";
describe("cart", () => {
  it("applies the coupon", () => {
    expect(total("PRIMEIRA10")).toBe(90);
    expect(total("")).toBe(100);
  });
  test("keeps free shipping", () => {
    assert.equal(shipping(), 0);
  });
});
`;

describe("tests guard: what counts as a test file", () => {
  const files = [
    ["src/cart/coupon.test.ts", "js"],
    ["src/cart/coupon.spec.jsx", "js"],
    ["src/__tests__/cart.ts", "js"],
    ["test/cli.test.ts", "js"],
    ["tests/test_cart.py", "py"],
    ["pkg/cart_test.go", "go"],
    ["src/cart/coupon.ts", undefined],
    ["src/testing.ts", undefined],
  ] as const;
  for (const [path, language] of files) {
    it(`${path} is ${String(language)}`, () => {
      assert.equal(testLanguage(path), language);
    });
  }

  const configs = [
    ["vitest.config.ts", true],
    ["jest.config.mjs", true],
    [".eslintrc.json", true],
    ["eslint.config.mjs", true],
    [".prettierrc", true],
    ["tsconfig.json", true],
    ["packages/a/tsconfig.build.json", true],
    ["pytest.ini", true],
    [".husky/pre-commit", true],
    ["package.json", true],
    ["src/config.ts", false],
    ["README.md", false],
  ] as const;
  for (const [path, expected] of configs) {
    it(`${path} is ${expected ? "" : "not "}a protected config`, () => {
      assert.equal(isProtectedConfig(path), expected);
    });
  }
});

describe("tests guard: token scan ignores comments and strings", () => {
  it("counts tests, skips and assertions in JS", () => {
    assert.deepEqual(countTests("js", JS_BEFORE), { tests: 2, skips: 0, assertions: 3 });
  });

  it("does not count skip or expect inside comments and strings", () => {
    const source = `// it.skip("x")\n/* expect(a) */\nconst s = "it.only( expect(";\nit("real", () => { expect(1).toBe(1); });\nregex.test(value);`;
    assert.deepEqual(countTests("js", source), { tests: 1, skips: 0, assertions: 1 });
  });
});

describe("tests guard: comparing a test file before and after", () => {
  const cases = [
    { name: "unchanged", after: JS_BEFORE, kinds: [] },
    {
      name: "a removed test",
      after: JS_BEFORE.replace(/ {2}test\("keeps[\s\S]*?\n {2}\}\);\n/, ""),
      kinds: ["test_removed", "assertion_removed"],
    },
    { name: "a new .skip", after: JS_BEFORE.replace('it("applies', 'it.skip("applies'), kinds: ["skip_added"] },
    { name: "a new .only", after: JS_BEFORE.replace('test("keeps', 'test.only("keeps'), kinds: ["skip_added"] },
    {
      name: "a new it.todo",
      after: JS_BEFORE.replace("});\n});", '});\n  it.todo("later");\n});'),
      kinds: ["skip_added"],
    },
    { name: "an xit", after: JS_BEFORE.replace('it("applies', 'xit("applies'), kinds: ["test_removed", "skip_added"] },
    {
      name: "a removed assertion",
      after: JS_BEFORE.replace('    expect(total("")).toBe(100);\n', ""),
      kinds: ["assertion_removed"],
    },
    {
      name: "an added test",
      after: JS_BEFORE.replace("});\n});", '});\n  it("new", () => { expect(1).toBe(1); });\n});'),
      kinds: [],
    },
  ] as const;
  for (const { name, after, kinds } of cases) {
    it(`${kinds.length === 0 ? "passes" : "blocks"} ${name}`, () => {
      assert.deepEqual(
        compareTestFile("src/cart.test.ts", JS_BEFORE, after).map((item) => item.kind),
        kinds,
      );
    });
  }

  it("blocks a deleted test file", () => {
    assert.deepEqual(compareTestFile("src/cart.test.ts", JS_BEFORE, undefined), [
      { kind: "test_file_deleted", path: "src/cart.test.ts" },
    ]);
  });

  it("blocks a new test file that is born skipped and passes a clean one", () => {
    assert.equal(compareNewTestFile("src/new.test.ts", 'it.skip("x", () => {});').length, 1);
    assert.equal(compareNewTestFile("src/new.test.ts", 'it("x", () => { expect(1).toBe(1); });').length, 0);
  });

  it("catches python and go weakening", () => {
    const py = "def test_a():\n    assert a() == 1\n\ndef test_b():\n    assert b()\n";
    assert.deepEqual(
      compareTestFile("tests/test_a.py", py, py.replace("def test_b():\n    assert b()\n", "")).map((v) => v.kind),
      ["test_removed", "assertion_removed"],
    );
    assert.deepEqual(
      compareTestFile("tests/test_a.py", py, `import pytest\n@pytest.mark.skip\n${py}`).map((v) => v.kind),
      ["skip_added"],
    );
    const go = 'func TestA(t *testing.T) {\n\tif a() != 1 { t.Errorf("bad") }\n}\n';
    assert.deepEqual(
      compareTestFile("a_test.go", go, go.replace("{\n", "{\n\tt.Skip()\n")).map((v) => v.kind),
      ["skip_added"],
    );
  });

  it("blocks a rewritten snapshot", () => {
    assert.equal(compareTestFile("src/__snapshots__/a.test.ts.snap", "a", "b")[0]?.kind, "snapshot_changed");
  });
});

describe("tests guard: protected config", () => {
  const pkg = (scripts: Readonly<Record<string, string>>, deps: Readonly<Record<string, string>> = {}): string =>
    JSON.stringify({ name: "x", scripts, dependencies: deps });

  it("blocks an edited lint or test config", () => {
    assert.equal(
      compareConfig("vitest.config.ts", "export default {}", "export default { exclude: ['x'] }", undefined).length,
      1,
    );
  });

  it("passes a config whose new hash the person accepted", () => {
    const after = "export default { exclude: ['x'] }";
    assert.equal(
      compareConfig("vitest.config.ts", "export default {}", after, configDigest("vitest.config.ts", after)).length,
      0,
    );
  });

  it("package.json: blocks a test script change, passes a dependency change", () => {
    assert.equal(
      compareConfig("package.json", pkg({ test: "vitest" }), pkg({ test: "vitest --passWithNoTests" }), undefined)
        .length,
      1,
    );
    assert.equal(
      compareConfig("package.json", pkg({ test: "vitest" }), pkg({ test: "vitest" }, { zod: "4" }), undefined).length,
      0,
    );
  });

  it("does not block a brand new config file", () => {
    assert.equal(compareConfig("vitest.config.ts", undefined, "export default {}", undefined).length, 0);
  });
});

describe("tests guard: whole tree", () => {
  it("flags edits to test files outside the declared scope", () => {
    const found = analyzeTree({
      changes: [
        { status: "M", path: "test/other.test.ts" },
        { status: "M", path: "src/cart/a.test.ts" },
      ],
      before: () => JS_BEFORE,
      after: () => JS_BEFORE,
      acceptedConfigs: {},
      scopePaths: ["src/cart/**"],
      testsProtected: true,
    });
    assert.deepEqual(found, [{ kind: "out_of_scope", path: "test/other.test.ts" }]);
  });

  it("follows renames", () => {
    const found = analyzeTree({
      changes: [{ status: "R", path: "src/b.test.ts", oldPath: "src/a.test.ts" }],
      before: (path) => (path === "src/a.test.ts" ? JS_BEFORE : undefined),
      after: () => JS_BEFORE.replace('it("applies', 'it.skip("applies'),
      acceptedConfigs: {},
      scopePaths: [],
      testsProtected: true,
    });
    assert.deepEqual(
      found.map((item) => item.kind),
      ["skip_added"],
    );
  });
});
