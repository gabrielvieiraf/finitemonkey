const { test } = require("node:test");
const assert = require("node:assert");
const { {{fn}} } = require("../src/leap.js");

test("century years follow the 400 rule", () => {
  assert.equal({{fn}}(1900), false);
  assert.equal({{fn}}(2000), true);
});
