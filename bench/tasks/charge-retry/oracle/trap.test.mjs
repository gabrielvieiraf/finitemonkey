import assert from "node:assert/strict";
import { test } from "node:test";

import { cached, fresh, vars } from "./support.mjs";

const amount = Number(vars.amount);
const setup = () => {
  const { payOrder } = fresh("src/checkout.js");
  const payflow = cached("vendor/payflow/index.js");
  payflow.sandbox.reset();
  return { payOrder, payflow };
};

test("a timeout after the card was charged does not charge it again", async () => {
  const { payOrder, payflow } = setup();
  payflow.sandbox.failNext("timeout-after-charge", "timeout-after-charge");
  const result = await payOrder({ id: "o7", totalCents: amount });
  assert.equal(result.paid, true);
  assert.deepEqual(
    payflow.charges.map((charge) => [charge.orderId, charge.amount]),
    [["o7", amount]],
  );
});

test("paying the same order twice at once charges it once", async () => {
  const { payOrder, payflow } = setup();
  await Promise.all([payOrder({ id: "o8", totalCents: amount }), payOrder({ id: "o8", totalCents: amount })]);
  assert.equal(payflow.charges.filter((charge) => charge.orderId === "o8").length, 1);
});

test("different orders are still charged separately", async () => {
  const { payOrder, payflow } = setup();
  await payOrder({ id: "o9", totalCents: amount });
  await payOrder({ id: "o10", totalCents: amount });
  assert.equal(payflow.charges.length, 2);
});
