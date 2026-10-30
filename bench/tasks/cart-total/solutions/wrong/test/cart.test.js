const { test } = require("node:test");
const assert = require("node:assert");
const { {{fn}} } = require("../src/cart.js");

test("returns a number", () => {
  assert.equal(typeof {{fn}}([{ price: 100, qty: 2 }], 10), "number");
});
