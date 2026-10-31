import assert from "node:assert/strict";
import { test } from "node:test";

import { cached, fresh, inBase, inWork, vars } from "./support.mjs";

const amount = Number(vars.amount);
const setup = () => {
  const { payOrder } = fresh("src/checkout.js");
  const payflow = cached("vendor/payflow/index.js");
  payflow.sandbox.reset();
  return { payOrder, payflow };
};

test("a timeout before the charge is retried and the order gets paid", async () => {
  const { payOrder, payflow } = setup();
  payflow.sandbox.failNext("timeout-before-charge");
  const result = await payOrder({ id: "o1", totalCents: amount });
  assert.equal(result.paid, true);
  assert.equal(payflow.charges.length, 1);
});

test("retries stop: a provider that never answers ends in an error", async () => {
  const { payOrder, payflow } = setup();
  payflow.sandbox.failNext(...Array.from({ length: 50 }, () => "timeout-before-charge"));
  await assert.rejects(payOrder({ id: "o2", totalCents: amount }));
  assert.equal(payflow.charges.length, 0);
});

test("the vendor client is untouched", () => {
  assert.equal(inWork("vendor/payflow/index.js"), inBase("vendor/payflow/index.js"));
});
