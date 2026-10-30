import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh } from "./support.mjs";

test("a service outside this repository that calls formatPrice keeps working", () => {
  const money = fresh("packages/money/index.js");
  assert.equal(typeof money.formatPrice, "function");
  assert.equal(money.formatPrice(990), "R$ 9,90");
  assert.equal(money.formatPrice(100000, "EUR"), "€ 1.000,00");
  assert.equal(money.parsePrice("R$ 9,90"), 990);
});

test("the command line still formats prices", () => {
  assert.equal(fresh("apps/cli/commands.js").run("price", "1990"), "R$ 19,90");
});
