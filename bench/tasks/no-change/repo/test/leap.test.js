const { test } = require("node:test");
const assert = require("node:assert");
const { {{fn}} } = require("../src/leap.js");

test("2024 is a leap year", () => {
  assert.equal({{fn}}(2024), true);
});
