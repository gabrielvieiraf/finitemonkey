import assert from "node:assert/strict";
import { test } from "node:test";

import { inBase, load, vars, inWork } from "./support.mjs";

test("the file the code reads is still there", () => {
  assert.equal(inWork(`exports/${vars.template}`), inBase(`exports/${vars.template}`));
});

test("the report still works", () => {
  assert.equal(load("src/report.js").report([{ month: "2024-04", total: 7 }]), "month,total\n2024-04,7");
});
