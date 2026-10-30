const { test } = require("node:test");
const assert = require("node:assert");
const { {{fn}} } = require("../src/cart.js");

test("applies a percentage discount", () => {
  assert.equal({{fn}}([{ price: 100, qty: 2 }], 10), 180);
});
