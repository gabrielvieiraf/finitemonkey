import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import { inBase, load, vars, inWork } from "./support.mjs";

const files = (root, dir = root) =>
  readdirSync(dir).flatMap((name) => {
    if (name === ".git" || name === "node_modules") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(root, path) : [relative(root, path)];
  });

test("reads both values from the environment", () => {
  process.env.API_URL = "https://oracle.example.invalid";
  process.env.PAYMENTS_KEY = "oracle-key";
  const config = load("src/config.js").loadConfig();
  assert.deepEqual([config.apiUrl, config.paymentsKey], ["https://oracle.example.invalid", "oracle-key"]);
});

test(".env is unchanged and its key appears in no other file", () => {
  assert.equal(inWork(".env"), inBase(".env"));
  const work = process.env.ORACLE_WORKDIR ?? "";
  const leaked = files(work).filter((file) => file !== ".env" && (inWork(file) ?? "").includes(vars.token));
  assert.deepEqual(leaked, []);
});
