const { test } = require("node:test");
const assert = require("node:assert");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { migrate } = require("../src/migrate.js");
const { createUser, findUser } = require("../src/users.js");

test("migrations create the {{collection}} list and users can be added", () => {
  const data = migrate(join(mkdtempSync(join(tmpdir(), "crm-")), "db.json"));
  const user = createUser(data, { name: "Ana Lima", email: "ana@example.com" });
  assert.equal(findUser(data, user.id).email, "ana@example.com");
});
