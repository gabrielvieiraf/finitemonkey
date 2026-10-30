const { test } = require("node:test");
const assert = require("node:assert");
const { dayOf } = require("../src/legacy-date.js");

test("reads the day in UTC", { skip: true }, () => {
  assert.equal(dayOf("2026-03-01T01:00:00-05:00"), 1);
});
