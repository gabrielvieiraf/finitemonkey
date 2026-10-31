const { test } = require("node:test");
const assert = require("node:assert");
const { charges, sandbox } = require("../vendor/payflow/index.js");
const { payOrder } = require("../src/checkout.js");

test("an order is charged its total", async () => {
  sandbox.reset();
  const result = await payOrder({ id: "o1", totalCents: {{amount}} });
  assert.equal(result.paid, true);
  assert.deepEqual(
    charges.map((charge) => charge.amount),
    [{{amount}}],
  );
});
