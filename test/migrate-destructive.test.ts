import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { destructiveStatements, hasRollbackPlan } from "../src/db/destructive.js";
import { readStats, sizesFor, touchedTables } from "../src/db/stats.js";
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
const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { applied: [], rows: {} });
const save = (db) => writeFileSync(file, JSON.stringify(db));
const mode = process.argv[2];
const db = load();
if (mode === "reset") save({ applied: [], rows: {} });
if (mode === "seed") save({ ...db, rows: { users: 3, orders: 5 } });
if (mode === "apply") {
  for (const name of existsSync("migrations") ? readdirSync("migrations").sort() : []) {
    if (db.applied.includes(name)) continue;
    for (const line of readFileSync("migrations/" + name, "utf8").split("\\n")) {
      const removed = /DELETE FROM (\\w+)/.exec(line);
      if (removed) db.rows[removed[1]] = 0;
    }
    db.applied.push(name);
  }
  save(db);
}
if (mode === "counts") console.log(JSON.stringify(db.rows));
`;

const IGNORE = ".fm/*\n!.fm/config.yml\n!.fm/policy.yml\ndb.json\n";

const project = (active: boolean): Repo => {
  const repo = makeRepo({
    ".gitignore": IGNORE,
    ".fm/config.yml": "lang: en\n",
    "tools/db.mjs": DB_TOOL,
    "migrations/001_users.sql": "CREATE TABLE users (id int, email text);\n",
  });
  repos.push(repo);
  if (active) repo.write(".fm/policy.yml", "guards:\n  migrate-check: active\n");
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

const seededConfig = (repo: Repo, extra: readonly string[] = []): string =>
  [
    "lang: en",
    "migrate:",
    `  url: "file:${join(repo.root, "db.json").replace(/\\/g, "/")}"`,
    '  reset: "node tools/db.mjs reset"',
    '  apply: "node tools/db.mjs apply"',
    '  seed: "node tools/db.mjs seed"',
    '  counts: "node tools/db.mjs counts"',
    ...extra,
    "",
  ].join("\n");

const run = (repo: Repo, criterion?: string) => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: "s1",
    budgetMs: 120_000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  const ctx: GateContext = { ...ready.prepared.ctx, trusted: true };
  const extra = criterion === undefined ? [] : [{ id: "rollback", kind: "manual" as const, description: criterion }];
  return migrateCheck(
    { id: "migrate", kind: "migrate" },
    { ...ctx, contract: { ...ctx.contract, acceptance: [...ctx.contract.acceptance, ...extra] } },
  );
};

const keys = (outcome: ReturnType<typeof migrateCheck>): readonly string[] => outcome.notes.map((item) => item.key);

describe("destructive migration statements", () => {
  it("finds drops, renames and type narrowing, and not a widening", () => {
    const sql = [
      "ALTER TABLE users DROP COLUMN email;",
      "DROP TABLE IF EXISTS audit;",
      "ALTER TABLE users RENAME COLUMN name TO full_name;",
      "ALTER TABLE orders ALTER COLUMN total TYPE integer;",
      "ALTER TABLE orders ALTER COLUMN id TYPE bigint;",
      "-- ALTER TABLE users DROP COLUMN ghost;",
    ].join("\n");
    assert.deepEqual(
      destructiveStatements("m.sql", sql).map((item) => `${item.kind}:${item.subject}:${String(item.line)}`),
      ["drop-column:users.email:1", "drop-table:audit:2", "rename:users.name:3", "type-narrowing:orders.total:4"],
    );
  });

  it("a rollback criterion counts only when it names the change", () => {
    const [drop] = destructiveStatements("migrations/002_drop.sql", "ALTER TABLE users DROP COLUMN email;");
    assert.ok(drop !== undefined);
    assert.equal(hasRollbackPlan(["rollback: restore users.email from the nightly snapshot"], drop), true);
    assert.equal(hasRollbackPlan(["rollback plan for 002_drop.sql is in the runbook"], drop), true);
    assert.equal(hasRollbackPlan(["users.email is no longer read"], drop), false);
    assert.equal(hasRollbackPlan(["rollback the orders change"], drop), false);
  });

  it("reads table sizes from an exported statistics file only", () => {
    const repo = makeRepo({
      "stats.json": JSON.stringify({ "public.users": { rows: 1200000, bytes: 9 }, orders: 40 }),
    });
    repos.push(repo);
    const stats = readStats(repoRuntime(), repo.root, "stats.json");
    const tables = touchedTables("ALTER TABLE users ADD COLUMN age int;\nCREATE INDEX i ON orders (id);");
    assert.deepEqual(tables, ["users", "orders"]);
    assert.deepEqual(
      sizesFor(stats, tables).map((size) => `${size.table}:${String(size.rows)}`),
      ["public.users:1200000", "orders:40"],
    );
    assert.equal(readStats(repoRuntime(), repo.root, "missing.json").ok, false);
  });
});

describe("migrate check with rollback plans, seeded rows and statistics", () => {
  it("holds a column drop without a rollback criterion in active mode, and passes with one", () => {
    const repo = project(true);
    repo.write("migrations/002_drop.sql", "ALTER TABLE users DROP COLUMN email;\n");
    const held = run(repo);
    assert.equal(held.status, "failed");
    assert.ok(keys(held).includes("gate.migrate.destructive.drop-column"));
    const planned = run(repo, "rollback: re-add users.email and backfill it from the snapshot");
    assert.equal(planned.status, "passed");
    assert.ok(keys(planned).includes("gate.migrate.rollback_planned"));
  });

  it("holds the missing rollback plan at the default level and only reports it at level light", () => {
    const repo = project(false);
    repo.write("migrations/002_drop.sql", "ALTER TABLE users DROP COLUMN email;\n");
    assert.equal(run(repo).status, "failed");
    repo.write(".fm/policy.yml", "level: light\n");
    const shadow = run(repo);
    assert.equal(shadow.status, "passed");
    assert.ok(keys(shadow).includes("gate.migrate.destructive.drop-column"));
  });

  it("reports a migration that deletes seeded rows with the counts before and after", () => {
    const repo = project(true);
    repo.write(".fm/config.yml", seededConfig(repo));
    repo.write("migrations/002_cleanup.sql", "DELETE FROM users;\n");
    const outcome = run(repo);
    assert.equal(outcome.status, "failed");
    const dropped = outcome.notes.find((item) => item.key === "gate.migrate.rows-dropped");
    assert.deepEqual(dropped?.params, { table: "users", before: 3, after: 0 });
  });

  it("a migration that keeps the seeded rows passes", () => {
    const repo = project(true);
    repo.write(".fm/config.yml", seededConfig(repo));
    repo.write("migrations/002_age.sql", "ALTER TABLE users ADD COLUMN age int;\n");
    assert.deepEqual(keys(run(repo)), ["gate.migrate.ok"]);
  });

  it("adds table sizes from migrate.stats and says when the file cannot be read", () => {
    const repo = project(true);
    repo.write("migrations/002_age.sql", "ALTER TABLE users ADD COLUMN age int;\n");
    repo.write(".fm/config.yml", 'lang: en\nmigrate:\n  stats: "stats.json"\n');
    assert.ok(keys(run(repo)).includes("gate.migrate.stats_unreadable"));
    repo.write("stats.json", JSON.stringify({ users: 52000000 }));
    const sized = run(repo).notes.find((item) => item.key === "gate.migrate.table_size");
    assert.deepEqual(sized?.params, { table: "users", rows: 52000000 });
  });
});
