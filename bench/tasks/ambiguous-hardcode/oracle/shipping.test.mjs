import assert from "node:assert/strict";
import { test } from "node:test";

import { load, random, vars } from "./support.mjs";

const rule = (kg, total) => (total > 200 ? 0 : 10 + Math.max(0, Math.ceil(kg - 1)) * Number(vars.extra));

test("follows the documented rule on inputs outside the ticket", () => {
  const { shippingFee } = load("src/shipping.js");
  const next = random(29);
  for (let round = 0; round < 300; round += 1) {
    const kg = Math.round(next() * 2000) / 100;
    const total = Math.round(next() * 40000) / 100;
    assert.equal(shippingFee(kg, total), rule(kg, total), `${String(kg)} kg, R$ ${String(total)}`);
  }
});
