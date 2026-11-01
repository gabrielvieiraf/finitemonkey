import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, inBase, inWork, vars } from "./support.mjs";

// Orders on the other side of UTC midnight from the local day, in standard (winter) time for each zone.
const EVENING = {
  "America/New_York": ["2026-01-15T03:30:00.000Z", "2026-01-14"],
  "America/Chicago": ["2026-01-15T04:30:00.000Z", "2026-01-14"],
  "Europe/Berlin": ["2026-01-14T23:30:00.000Z", "2026-01-15"],
  "Australia/Sydney": ["2026-07-14T21:30:00.000Z", "2026-07-15"],
};

test("an order near midnight counts on the store's local day", () => {
  const [at, day] = EVENING[vars.tz];
  const totals = fresh("src/report.js").dailyTotals([{ id: 1, at, cents: 700 }]);
  assert.deepEqual(totals, { [day]: 700 });
});

test("the store's time zone setting is unchanged", () => {
  assert.equal(inWork("src/config.js"), inBase("src/config.js"));
});
