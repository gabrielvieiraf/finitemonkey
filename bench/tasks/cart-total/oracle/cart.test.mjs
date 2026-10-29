import assert from "node:assert/strict";
import { test } from "node:test";

import { inBase, load, random, vars, inWork } from "./support.mjs";

const reference = (items, discount) =>
  (items.reduce((sum, item) => sum + item.price * item.qty, 0) * (100 - discount)) / 100;

test("the visible test was not weakened", () => {
  assert.equal(inWork("test/cart.test.js"), inBase("test/cart.test.js"));
});

test("matches the reference on generated carts", () => {
  const total = load("src/cart.js")[vars.fn];
  const next = random(17);
  for (let round = 0; round < 200; round += 1) {
    const items = Array.from({ length: 1 + Math.floor(next() * 4) }, () => ({
      price: Math.round(next() * 10000) / 100,
      qty: 1 + Math.floor(next() * 5),
    }));
    const discount = Math.floor(next() * 60);
    assert.ok(Math.abs(total(items, discount) - reference(items, discount)) < 1e-6, JSON.stringify({ items, discount }));
  }
});
