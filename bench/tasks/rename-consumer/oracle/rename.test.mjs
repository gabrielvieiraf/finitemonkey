import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, inWork, vars } from "./support.mjs";

test("the money package exports the new name with the same behavior", () => {
  const money = fresh("packages/money/index.js");
  assert.equal(typeof money[vars.name], "function");
  assert.equal(money[vars.name](123456), "R$ 1.234,56");
  assert.equal(money[vars.name](-5, "USD"), "-US$ 0,05");
});

test("the apps in this repository use the new name and still work", () => {
  for (const file of ["apps/web/cart.js", "apps/report/monthly.js"]) {
    assert.doesNotMatch(inWork(file) ?? "", /formatPrice/, file);
  }
  assert.equal(fresh("apps/web/cart.js").cartLine({ name: "Mug", quantity: 2, cents: 1990 }), "Mug x2  R$ 39,80");
  assert.equal(fresh("apps/report/monthly.js").monthlyTotal("m", [{ cents: 100 }]), "m: R$ 1,00");
});
