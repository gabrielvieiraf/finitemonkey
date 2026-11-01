import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest } from "../src/core/runtime.js";
import { parseMigrations, type Table } from "../src/scenarios/policies.js";
import {
  isOpenPolicy,
  type OwnedTable,
  ownedTables,
  type RowDb,
  rowFindings,
  rowsConfig,
  runRows,
  USER_A_ID,
  USER_B_ID,
} from "../src/scenarios/rows.js";
import { countSql, seedSql } from "../src/scenarios/rows-sql.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, execResult, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const MIGRATION = [
  "create table public.notes (",
  "  id uuid primary key default gen_random_uuid(),",
  "  user_id uuid not null references auth.users (id) on delete cascade,",
  "  body text not null,",
  "  created_at timestamptz not null default now()",
  ");",
  "alter table public.notes enable row level security;",
  'create policy "own notes" on public.notes for select to authenticated using (auth.uid() = user_id);',
  "create function touch() returns trigger as $$ begin new.created_at = now(); return new; end; $$ language plpgsql;",
  "",
  "create table orders (",
  "  id bigint generated always as identity primary key,",
  '  "owner_id" uuid not null,',
  "  total integer not null,",
  "  constraint positive check (total > 0)",
  ");",
  "",
].join("\n");

const config = rowsConfig({});

interface Row {
  readonly owner: string;
}

const visible = (owned: OwnedTable, user: string, row: Row): boolean =>
  !owned.table.rls ||
  owned.table.policies.some(
    (policy) =>
      (policy.command === "select" || policy.command === "all") &&
      (isOpenPolicy(policy.using, owned.owner.name) || row.owner === user),
  );

const fixtureDb = (): RowDb & { readonly seeded: () => number } => {
  const rows = new Map<string, Row[]>();
  return {
    prepare: () => undefined,
    seed: (owned, users) => {
      for (const { table } of owned)
        rows.set(
          table.name,
          users.map((owner) => ({ owner })),
        );
      return undefined;
    },
    count: (user, owned, value) =>
      (rows.get(owned.table.name) ?? []).filter((row) => row.owner === value && visible(owned, user, row)).length,
    seeded: () => [...rows.values()].reduce((sum, list) => sum + list.length, 0),
  };
};

describe("row-level rules: parsing the migrations", () => {
  it("reads tables, owner columns, row-level security and policies, skipping function bodies", () => {
    const tables = parseMigrations([MIGRATION]);
    assert.deepEqual(
      tables.map((table: Table) => [
        table.name,
        table.rls,
        table.policies.map((policy) => `${policy.command}:${policy.using}`),
      ]),
      [
        ["notes", true, ["select:auth.uid() = user_id"]],
        ["orders", false, []],
      ],
    );
    const owned = ownedTables(tables, config);
    assert.deepEqual(
      owned.map((item) => [item.table.name, item.owner.name, item.owner.references ?? "-"]),
      [
        ["notes", "user_id", "auth.users"],
        ["orders", "owner_id", "-"],
      ],
    );
    assert.deepEqual(rowFindings(owned), [{ table: "orders", kind: "rls_off" }]);
  });

  it("flags a read policy that lets everyone through", () => {
    const tables = parseMigrations([
      "create table docs (id serial primary key, owner_id uuid not null);",
      "alter table docs enable row level security;",
      "create policy open_read on docs for select using (true);",
    ]);
    assert.deepEqual(rowFindings(ownedTables(tables, config)), [
      { table: "docs", kind: "policy_open", policy: "open_read" },
    ]);
  });
});

describe("row-level rules: two seeded users", () => {
  it("a table with no policy lets user B read user A's row and is reported; the protected table passes", () => {
    const db = fixtureDb();
    const run = runRows(ownedTables(parseMigrations([MIGRATION]), config), config, db);
    assert.equal(run.kind, "ran");
    assert.equal(db.seeded(), 4);
    assert.deepEqual(
      run.results.map((item) => [item.id, item.count, item.passed]),
      [
        ["notes.owner_reads", 1, true],
        ["notes.other_reads", 0, true],
        ["orders.owner_reads", 1, true],
        ["orders.other_reads", 1, false],
      ],
    );
  });

  it("seeds every required column and reads as the user inside a rolled-back transaction", () => {
    const owned = ownedTables(parseMigrations([MIGRATION]), config);
    const seed = seedSql(owned, [USER_A_ID, USER_B_ID]);
    assert.match(seed, /insert into auth\.users \(id\) values/);
    assert.match(
      seed,
      new RegExp(`insert into "notes" \\("user_id", "body"\\) values \\('${USER_A_ID}', 'notes:body:${USER_A_ID}'\\);`),
    );
    assert.match(seed, /insert into "orders" \("owner_id", "total"\) values/);
    const [notes] = owned;
    assert.ok(notes !== undefined);
    const sql = countSql(config.asUser, USER_B_ID, notes, `'${USER_A_ID}'`);
    assert.match(sql, /^begin;\nset local role authenticated;/);
    assert.match(sql, new RegExp(`'request\\.jwt\\.claim\\.sub', '${USER_B_ID}'`));
    assert.match(sql, /rollback;\n$/);
  });
});

const PSQL = 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -q';

const fakePsql = (tables: readonly Table[], seen: ExecRequest[]) => (request: ExecRequest) => {
  seen.push(request);
  if (request.command === "reset-db" || request.command === "apply-db") return execResult(0);
  if (request.command !== PSQL) return execResult(127, "", "unexpected command");
  const input = request.input ?? "";
  if (!input.includes("fm-count")) return execResult(0);
  const table = /from "([^"]+)"/.exec(input)?.[1] ?? "";
  const user = /claim\.sub', '([^']+)'/.exec(input)?.[1] ?? "";
  const owner = /= '([^']+)';/.exec(input)?.[1] ?? "";
  const owned = ownedTables(tables, config).find((item) => item.table.name === table);
  const count =
    owned === undefined
      ? 0
      : [USER_A_ID, USER_B_ID].filter((id) => id === owner && visible(owned, user, { owner: id })).length;
  return execResult(0, `${user}|${user}|${user}\nfm-count:${String(count)}\n`);
};

const project = (url: string): Repo => {
  const repo = makeRepo({
    "supabase/migrations/0001_init.sql": MIGRATION,
    ".finitemonkey/config.yml": ["migrate:", `  url: "${url}"`, "  reset: reset-db", "  apply: apply-db", ""].join(
      "\n",
    ),
  });
  repos.push(repo);
  return repo;
};

describe("row-level rules: scenarios run on the throwaway database", () => {
  it("applies the migrations, seeds both users and reports the leak, all through a fake database", async () => {
    const repo = project("postgres://127.0.0.1:5432/throwaway");
    const seen: ExecRequest[] = [];
    const runtime = { ...repoRuntime(), exec: fakePsql(parseMigrations([MIGRATION]), seen) };
    const run = await cliJson(["scenarios", "run"], { runtime, cwd: repo.root });
    assert.equal(run.code, 0, run.stdout);
    assert.equal(field(run.body, "data", "ran"), true);
    assert.equal(field(run.body, "data", "rows", "state"), "ran");
    const rows = field(run.body, "data", "rows", "results");
    const failed = (Array.isArray(rows) ? rows : []).filter((item: unknown) => field(item, "passed") === false);
    assert.deepEqual(
      failed.map((item: unknown) => field(item, "id")),
      ["orders.other_reads"],
    );
    assert.deepEqual(
      seen.slice(0, 2).map((request) => request.command),
      ["reset-db", "apply-db"],
    );
    assert.ok(seen.every((request) => request.env?.["DATABASE_URL"] === "postgres://127.0.0.1:5432/throwaway"));
    const listed = await cliJson(["scenarios"], { runtime, cwd: repo.root });
    assert.deepEqual(field(listed.body, "data", "policies"), [{ table: "orders", kind: "rls_off" }]);
  });

  it("refuses a database that is not on this machine", async () => {
    const repo = project("postgres://db.example.com:5432/prod");
    const seen: ExecRequest[] = [];
    const runtime = { ...repoRuntime(), exec: fakePsql([], seen) };
    const run = await cliJson(["scenarios", "run"], { runtime, cwd: repo.root });
    assert.equal(field(run.body, "data", "rows", "state"), "refused");
    assert.equal(field(run.body, "data", "ran"), false);
    assert.deepEqual(seen, []);
  });
});
