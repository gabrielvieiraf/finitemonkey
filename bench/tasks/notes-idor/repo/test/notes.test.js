const { test } = require("node:test");
const assert = require("node:assert");
const { handle } = require("../src/app.js");

const ana = { authorization: "Bearer token-ana" };

test("a signed-in user creates and reads a note", () => {
  const created = handle({ method: "POST", path: "/notes", headers: ana, body: { {{field}}: "buy milk" } });
  assert.equal(created.status, 201);
  const read = handle({ method: "GET", path: `/notes/${created.body.id}`, headers: ana });
  assert.equal(read.body.{{field}}, "buy milk");
});

test("nobody gets in without a token", () => {
  assert.equal(handle({ method: "GET", path: "/notes" }).status, 401);
});
