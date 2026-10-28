import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseYaml } from "../src/core/yaml/parse.js";

describe("YAML block scalars", () => {
  it("reads literal and folded blocks with chomping, keeping # inside the block", () => {
    const parsed = parseYaml(
      "a: |\n  x\n  # kept\n\n  y\nb: >-\n  one\n  two\n\n  three\nc:\n  - run: |\n      echo 1\n    name: n\nd: |+\n  z\n\ne: 1\n",
    );
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      a: "x\n# kept\n\ny\n",
      b: "one two\nthree",
      c: [{ run: "echo 1\n", name: "n" }],
      d: "z\n\n",
      e: 1,
    });
  });

  it("leaves a pipe at the end of a plain value alone", () => {
    const parsed = parseYaml("a: x |\n");
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, { a: "x |" });
  });
});
