import assert from "node:assert/strict";
import { test } from "node:test";

import { rows, seeded } from "./db.mjs";
import { fresh } from "./support.mjs";

test("the migration gives every person a first and a last name", () => {
  const db = seeded(["Ana Lima", "Bruno Costa"]);
  const { migrate } = fresh("src/migrate.js");
  migrate(db.path);
  const people = rows(db.read());
  assert.deepEqual(
    people.map((person) => [person.first_name, person.last_name]),
    [
      ["Ana", "Lima"],
      ["Bruno", "Costa"],
    ],
  );
});

test("e-mails greet people by their first name", () => {
  const db = seeded(["Ana Lima"]);
  const { migrate } = fresh("src/migrate.js");
  const data = migrate(db.path);
  const { greeting, createUser } = fresh("src/users.js");
  assert.equal(greeting(rows(data)[0]), "Hi Ana,");
  assert.equal(greeting(createUser(data, { name: "Bruno Costa", email: "b@example.com" })), "Hi Bruno,");
});
