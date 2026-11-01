import assert from "node:assert/strict";
import { test } from "node:test";

import { cached, fresh } from "./support.mjs";

const HOUR = 60 * 60 * 1000;

test("after logout the app cannot sign the person back in with the refresh token", () => {
  const { signedInUser } = fresh("src/client.js");
  const { login, logout } = cached("src/sessions.js");
  const tokens = { ...login("u1", 0) };
  logout(tokens.accessToken);
  assert.equal(signedInUser(tokens, 1000), undefined);
  assert.equal(signedInUser(tokens, 24 * HOUR), undefined);
});

test("logout after a renewal also ends the renewed session", () => {
  const { signedInUser } = fresh("src/client.js");
  const { login, logout, renew } = cached("src/sessions.js");
  const first = login("u1", 0);
  const tokens = { ...first };
  assert.equal(signedInUser(tokens, 24 * HOUR), "u1");
  logout(tokens.accessToken);
  assert.equal(signedInUser(tokens, 24 * HOUR + 1), undefined);
  assert.equal(renew(tokens.refreshToken, 24 * HOUR + 2), undefined);
});
