import assert from "node:assert/strict";
import { test } from "node:test";

import { load, vars, inWork } from "./support.mjs";

const MODULES = ["profile", "invoice", "comment", "audit", "mailer", "badge"];

test("every module still names the user", () => {
  for (const name of MODULES) {
    const line = load(`src/${name}.js`)[`${name}Line`];
    assert.equal(line({ first: "Ana", last: "Lima" }, "x"), "Ana Lima: x", name);
  }
});

test("users.js exports the new name and no call site or doc keeps the old one", () => {
  assert.equal(typeof load("src/users.js")[vars.name], "function");
  const stale = [...MODULES.map((name) => `src/${name}.js`), "docs/API.md"].filter((file) =>
    (inWork(file) ?? "").includes("getUserName"),
  );
  assert.deepEqual(stale, []);
});
