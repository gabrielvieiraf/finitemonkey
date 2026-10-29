const { test } = require("node:test");
const assert = require("node:assert");
const { loadConfig } = require("../src/config.js");

test("returns an object", () => {
  assert.equal(typeof loadConfig(), "object");
});
