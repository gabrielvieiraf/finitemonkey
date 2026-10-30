import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { ExecRequest } from "../src/core/runtime.js";
import { lockRisks } from "../src/db/locks.js";
import { isLocalDatabase } from "../src/db/throwaway.js";
import { migrateCheck } from "../src/gate/checks/migrate.js";
import { prepareGate } from "../src/gate/prepare.js";
import type { GateContext } from "../src/gate/types.js";
import { createTask } from "../src/task/create.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const DB_TOOL = `import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
const file = process.env.DATABASE_URL.slice("file:".length);
const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { applied: [], columns: [] });
const save = (db) => writeFileSync(file, JSON.stringify(db));
const apply = (db, line) => {
  const add = /ADD COLUMN (\\w+)/.exec(line);
  const drop = /DROP COLUMN (\\w+)/.exec(line);
  if (add) db.columns.push(add[1]);
  if (drop) db.columns = db.columns.filter((c) => c !== drop[1]);
};
const mode = process.argv[2];
const db = load();
if (mode === "reset") save({ applied: [], columns: [] });
if (mode === "apply") {
  for (const name of existsSync("migrations") ? readdirSync("migrations").sort() : []) {
    if (db.applied.includes(name)) continue;
    for (const line of readFileSync("migrations/" + name, "utf8").split("\\n")) if (!line.startsWith("--")) apply(db, line);
    db.applied.push(name);
  }
  save(db);
}
if (mode === "down") {
  const name = db.applied.pop();
  const text = readFileSync("migrations/" + name, "utf8");
  for (const line of text.split("\\n")) if (line.startsWith("-- down:")) apply(db, line);
  save(db);
}
if (mode === "dump") console.log([...db.columns].sort().join("\\n"));
if (mode === "test") process.exit(db.columns.includes("email") ? 0 : 1);
`;

const IGNORE = ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/policy.yml\ndb.json\n";

const config = (url: string, extra = ""): string =>
  [
    "lang: en",
    "migrate:",
    `  url: "${url}"`,
    '  reset: "node tools/db.mjs reset"',
    '  apply: "node tools/db.mjs apply"',
    '  dump: "node tools/db.mjs dump"',
    '  base_tests: "node tools/db.mjs test"',
    extra,
  ].join("\n");

const project = (configText: string): Repo => {
  const repo = makeRepo({
    ".gitignore": IGNORE,
    ".finitemonkey/config.yml": configText,
    "tools/db.mjs": DB_TOOL,
    "migrations/001_users.sql": "ALTER TABLE users ADD COLUMN email text;\n-- down: DROP COLUMN email\n",
  });
  repos.push(repo);
  const created = createTask(repoRuntime(), fmPaths(repo.root), {
    id: "t1",
    goal: "change the users table",
    size: "S",
    base: repo.git("rev-parse", "HEAD").trim(),
    paths: [],
    runs: [],
    tests: undefined,
    git: [],
    manual: [],
    budget: undefined,
  });
  assert.ok(created.ok);
  return repo;
};

const localUrl = (repo: Repo): string => `file:${join(repo.root, "db.json").replace(/\\/g, "/")}`;

const run = (repo: Repo, seen: string[] = []) => {
  const base = repoRuntime();
  const runtime = {
    ...base,
    exec: (request: ExecRequest) => {
      seen.push(request.command);
      return base.exec(request);
    },
  };
  const ready = prepareGate({
    runtime,
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 120_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  const ctx: GateContext = { ...ready.prepared.ctx, trusted: true };
  assert.ok(
    ctx.contract.acceptance.some((check) => check.kind === "migrate"),
    "the check is added when migrations change",
  );
  return migrateCheck({ id: "migrate", kind: "migrate" }, ctx);
};

const keys = (outcome: ReturnType<typeof migrateCheck>): readonly string[] => outcome.notes.map((item) => item.key);

describe("migration lock risks", () => {
  it("lists an index created without concurrent mode, and not one created concurrently", () => {
    const sql = "CREATE INDEX users_email ON users (email);\nCREATE INDEX CONCURRENTLY users_name ON users (name);\n";
    assert.deepEqual(
      lockRisks("m.sql", sql, "postgres").map((risk) => `${risk.kind}:${String(risk.line)}`),
      ["index-not-concurrent:1"],
    );
    assert.deepEqual(
      lockRisks("m.sql", "ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES b (id) NOT VALID;", "postgres"),
      [],
    );
    assert.equal(lockRisks("m.sql", "ALTER TABLE t ALTER COLUMN a TYPE bigint;", "postgres")[0]?.kind, "column-type");
  });

  it("refuses database URLs that are not local", () => {
    assert.equal(isLocalDatabase("postgres://app@db.prod.example.com:5432/app"), false);
    assert.equal(isLocalDatabase("postgres://localhost:5433/fm_throwaway"), true);
    assert.equal(isLocalDatabase("file:/tmp/db.json"), true);
  });
});

describe("migrate gate check", () => {
  it("reports an edited migration that exists on the base, in shadow and then blocking", () => {
    const repo = project("lang: en\n");
    repo.write("migrations/001_users.sql", "ALTER TABLE users ADD COLUMN mail text;\n");
    const shadow = run(repo);
    assert.equal(shadow.status, "passed");
    assert.ok(keys(shadow).includes("gate.migrate.applied-edited"));
    repo.write(".finitemonkey/policy.yml", "guards:\n  migrate-check: active\n");
    assert.equal(run(repo).status, "failed");
  });

  it("refuses a non-local database URL without running any command", () => {
    const repo = project(config("postgres://app@db.prod.example.com/app"));
    repo.write("migrations/002_age.sql", "ALTER TABLE users ADD COLUMN age int;\n");
    const seen: string[] = [];
    const outcome = run(repo, seen);
    assert.ok(keys(outcome).includes("gate.migrate.refused"));
    assert.deepEqual(
      seen.filter((command) => command.includes("tools/db.mjs")),
      [],
    );
  });

  it("dropping a column the base app still reads fails the compatibility run", () => {
    const repo = project("");
    repo.write(".finitemonkey/config.yml", config(localUrl(repo)));
    repo.write("migrations/002_drop.sql", "ALTER TABLE users DROP COLUMN email;\n");
    assert.ok(keys(run(repo)).includes("gate.migrate.compat-broken"));
  });

  it("a down migration that does not restore the base schema is reported; a correct one passes", () => {
    const repo = project("");
    repo.write(".finitemonkey/config.yml", config(localUrl(repo), '  down: "node tools/db.mjs down"'));
    repo.write("migrations/002_age.sql", "ALTER TABLE users ADD COLUMN age int;\n-- down: ADD COLUMN junk\n");
    assert.ok(keys(run(repo)).includes("gate.migrate.down-mismatch"));
    repo.write("migrations/002_age.sql", "ALTER TABLE users ADD COLUMN age int;\n-- down: DROP COLUMN age\n");
    const clean = run(repo);
    assert.deepEqual(keys(clean), ["gate.migrate.ok"]);
  });
});
