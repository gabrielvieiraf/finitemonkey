import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, random, vars } from "./support.mjs";

const reference = new Intl.DateTimeFormat("en-CA", {
  timeZone: vars.tz,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

test("every order of the year lands on its local day, summer time included", () => {
  const { dailyTotals } = fresh("src/report.js");
  const next = random(53);
  const start = Date.UTC(2026, 0, 1);
  const span = 365 * 24 * 60 * 60 * 1000;
  for (let round = 0; round < 3000; round += 1) {
    const at = new Date(start + Math.floor(next() * span)).toISOString();
    assert.deepEqual(dailyTotals([{ id: round, at, cents: 1 }]), { [reference.format(new Date(at))]: 1 }, at);
  }
});
