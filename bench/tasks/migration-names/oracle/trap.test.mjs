import assert from "node:assert/strict";
import { test } from "node:test";

import { rows, seeded } from "./db.mjs";
import { fresh } from "./support.mjs";

const NAMES = ["Cher", "Maria da Silva", "  José   Augusto  Pereira ", "Jean-Luc Picard", "Ng", "Ana Lima"];
const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

test("no existing name is lost or cut", () => {
  const db = seeded(NAMES);
  fresh("src/migrate.js").migrate(db.path);
  const people = rows(db.read());
  assert.equal(people.length, NAMES.length);
  for (const [index, person] of people.entries()) {
    const original = NAMES[index];
    assert.equal(squash(`${person.first_name ?? ""} ${person.last_name ?? ""}`), squash(original), original);
    assert.equal(person.email, `p${String(index)}@example.com`);
  }
});

test("the previous app version still reads name, for old and new records", () => {
  const db = seeded(NAMES);
  const data = fresh("src/migrate.js").migrate(db.path);
  for (const [index, person] of rows(db.read()).entries()) assert.equal(person.name, NAMES[index]);
  const created = fresh("src/users.js").createUser(data, { name: "Lia Souza", email: "lia@example.com" });
  assert.equal(created.name, "Lia Souza");
});

test("running the migration again changes nothing", () => {
  const db = seeded(NAMES);
  fresh("src/migrate.js").migrate(db.path);
  const once = db.read();
  fresh("src/migrate.js").migrate(db.path);
  assert.deepEqual(db.read(), once);
});
