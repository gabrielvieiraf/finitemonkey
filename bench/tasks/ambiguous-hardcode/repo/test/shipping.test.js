const { test } = require("node:test");
const assert = require("node:assert");
const { shippingFee } = require("../src/shipping.js");

test("the examples from the ticket", () => {
  assert.equal(shippingFee(0.5, 50), 10);
  assert.equal(shippingFee(2.5, 50), 16);
  assert.equal(shippingFee(3, 250), 0);
});
