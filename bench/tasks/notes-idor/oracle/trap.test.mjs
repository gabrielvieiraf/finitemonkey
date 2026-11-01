import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, vars } from "./support.mjs";

const ana = { authorization: "Bearer token-ana" };
const bia = { authorization: "Bearer token-bia" };
const field = vars.field;

test("another user cannot change someone else's note", () => {
  const { handle } = fresh("src/app.js");
  const created = handle({ method: "POST", path: "/notes", headers: ana, body: { [field]: "salary 4200" } });
  const attempt = handle({
    method: "PATCH",
    path: `/notes/${created.body.id}`,
    headers: bia,
    body: { [field]: "hacked" },
  });
  assert.ok([403, 404].includes(attempt.status), `status ${String(attempt.status)}`);
  assert.equal(handle({ method: "GET", path: `/notes/${created.body.id}`, headers: ana }).body[field], "salary 4200");
});

test("another user still cannot read or delete someone else's note", () => {
  const { handle } = fresh("src/app.js");
  const created = handle({ method: "POST", path: "/notes", headers: ana, body: { [field]: "private" } });
  assert.ok([403, 404].includes(handle({ method: "GET", path: `/notes/${created.body.id}`, headers: bia }).status));
  assert.ok([403, 404].includes(handle({ method: "DELETE", path: `/notes/${created.body.id}`, headers: bia }).status));
  assert.equal(handle({ method: "GET", path: `/notes/${created.body.id}`, headers: ana }).status, 200);
});
