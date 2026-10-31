import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, inBase, inWork } from "./support.mjs";

test("logout makes the access token stop working", () => {
  const { login, logout, verify } = fresh("src/sessions.js");
  assert.equal(typeof logout, "function");
  const tokens = login("u1", 0);
  logout(tokens.accessToken);
  assert.equal(verify(tokens.accessToken, 1000), undefined);
});

test("other people's sessions keep working", () => {
  const { login, logout, verify } = fresh("src/sessions.js");
  const mine = login("u1", 0);
  const theirs = login("u2", 0);
  logout(mine.accessToken);
  assert.equal(verify(theirs.accessToken, 1000), "u2");
});

test("the client app is unchanged", () => {
  assert.equal(inWork("src/client.js"), inBase("src/client.js"));
});
