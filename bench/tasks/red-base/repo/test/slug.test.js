const { test } = require("node:test");
const assert = require("node:assert");
const { {{fn}} } = require("../src/slug.js");

test("joins words with dashes", () => {
  assert.equal({{fn}}("Hello World"), "hello-world");
});
