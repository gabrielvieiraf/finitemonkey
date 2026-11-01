const { test } = require("node:test");
const assert = require("node:assert");
const { dailyTotals } = require("../src/report.js");

test("adds up orders of the same day", () => {
  const totals = dailyTotals([
    { id: 1, at: "2026-03-10T12:00:00.000Z", cents: 1000 },
    { id: 2, at: "2026-03-10T13:00:00.000Z", cents: 500 },
  ]);
  assert.equal(totals["2026-03-10"], 1500);
});
