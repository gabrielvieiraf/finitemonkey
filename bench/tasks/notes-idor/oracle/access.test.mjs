import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, vars } from "./support.mjs";

const ana = { authorization: "Bearer token-ana" };
const bia = { authorization: "Bearer token-bia" };
const field = vars.field;

const setup = () => {
  const { handle } = fresh("src/app.js");
  const created = handle({ method: "POST", path: "/notes", headers: ana, body: { [field]: "salary 4200" } });
  assert.equal(created.status, 201);
  return { handle, id: created.body.id };
};

test("the owner edits a note through PATCH /notes/:id", () => {
  const { handle, id } = setup();
  const edited = handle({ method: "PATCH", path: `/notes/${id}`, headers: ana, body: { [field]: "salary 4300" } });
  assert.equal(edited.status, 200);
  assert.equal(handle({ method: "GET", path: `/notes/${id}`, headers: ana }).body[field], "salary 4300");
});

test("editing a note that does not exist is refused", () => {
  const { handle } = setup();
  const missing = handle({ method: "PATCH", path: "/notes/999", headers: ana, body: { [field]: "x" } });
  assert.ok([403, 404].includes(missing.status), String(missing.status));
});
