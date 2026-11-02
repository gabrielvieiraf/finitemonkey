const { test } = require("node:test");
const assert = require("node:assert");
const { login, verify } = require("../src/sessions.js");
const { signedInUser } = require("../src/client.js");

test("a fresh login works", () => {
  const tokens = login("u1", 0);
  assert.equal(verify(tokens.accessToken, 1000), "u1");
});

test("the app keeps people signed in after the access token expires", () => {
  const tokens = { ...login("u2", 0) };
  assert.equal(signedInUser(tokens, 24 * 60 * 60 * 1000), "u2");
});
