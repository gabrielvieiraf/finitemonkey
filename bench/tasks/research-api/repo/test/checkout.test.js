const { test } = require("node:test");
const assert = require("node:assert");
const { charge } = require("../src/checkout.js");

test("starts a pending charge", () => {
  assert.equal(charge(10).status, "pending");
});
