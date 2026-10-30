const { test } = require("node:test");
const assert = require("node:assert");
const { cartLine } = require("../apps/web/cart.js");
const { monthlyTotal } = require("../apps/report/monthly.js");

test("the cart shows line prices", () => {
  assert.equal(cartLine({ name: "Mug", quantity: 2, cents: 1990 }), "Mug x2  R$ 39,80");
});

test("the monthly report shows the total", () => {
  assert.equal(monthlyTotal("2026-09", [{ cents: 100000 }, { cents: 50 }]), "2026-09: R$ 1.000,50");
});
