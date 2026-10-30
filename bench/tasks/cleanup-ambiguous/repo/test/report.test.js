const { test } = require("node:test");
const assert = require("node:assert");
const { report } = require("../src/report.js");

test("starts with the header", () => {
  assert.match(report([]), /^month,total/);
});
