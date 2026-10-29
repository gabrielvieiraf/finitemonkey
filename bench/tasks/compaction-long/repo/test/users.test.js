const { test } = require("node:test");
const assert = require("node:assert");
const { profileLine } = require("../src/profile.js");

test("names the user", () => {
  assert.equal(profileLine({ first: "Ana", last: "Lima" }, "edited"), "Ana Lima: edited");
});
