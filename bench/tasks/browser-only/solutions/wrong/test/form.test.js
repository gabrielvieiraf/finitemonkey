const { test } = require("node:test");
const assert = require("node:assert");
const { renderForm } = require("../src/form.js");

test("has the submit button", () => {
  assert.match(renderForm(), /<button type="submit"/);
});
