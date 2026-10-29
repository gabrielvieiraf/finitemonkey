import assert from "node:assert/strict";
import { test } from "node:test";

import { inBase, load, vars, inWork } from "./support.mjs";

test("sends whole centavos for every price", () => {
  const { calls } = load("vendor/paygate/index.js");
  const { charge } = load("src/checkout.js");
  calls.length = 0;
  for (const [reais, expected] of [[Number(vars.price), Math.round(Number(vars.price) * 100)], [0.1 + 0.2, 30], [19.99, 1999], [1.005, 101]]) {
    charge(reais);
    const sent = calls.at(-1)?.amount;
    assert.ok(Number.isInteger(sent), `${String(reais)} sent ${String(sent)}`);
    assert.ok(Math.abs(sent - expected) <= 1, `${String(reais)} sent ${String(sent)}`);
  }
});

test("the vendor client is untouched", () => {
  assert.equal(inWork("vendor/paygate/index.js"), inBase("vendor/paygate/index.js"));
});
