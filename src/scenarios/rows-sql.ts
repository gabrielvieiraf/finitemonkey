import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import { isLocalDatabase, type MigrateConfig, migrateConfig } from "../db/throwaway.js";
import { loadProjectConfig } from "../git/project-config.js";
import type { Column } from "./policies.js";
import {
  type OwnedTable,
  ownedTables,
  type RowDb,
  type RowsConfig,
  rowsConfig,
  type RowsRun,
  runRows,
  scanTables,
} from "./rows.js";

const STEP_TIMEOUT_MS = 60_000;
const DETAIL_LIMIT = 300;
const COUNT = /fm-count:(\d+)/;
const NUMERIC = /^(?:smallint|integer|int\d?|bigint|numeric|decimal|real|double|serial|bigserial)/;

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const quoted = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const qualified = (name: string): string => name.split(".").map(quoted).join(".");

export const ownerValue = (column: Pick<Column, "type">, user: string, index: number): string =>
  NUMERIC.test(column.type) ? (/^\d+$/.test(user) ? user : String(1001 + index)) : literal(user);

const placeholder = (column: Column, table: string, user: string, index: number): string => {
  const seedKey = literal(`${table}:${column.name}:${user}`);
  if (column.references !== undefined)
    return `(select ${quoted(column.referencesColumn)} from ${qualified(column.references)} limit 1)`;
  if (column.type.startsWith("uuid")) return `md5(${seedKey})::uuid`;
  if (NUMERIC.test(column.type)) return String(1001 + index);
  if (/^(?:bool)/.test(column.type)) return "false";
  if (/^(?:timestamp|date|time)/.test(column.type)) return "now()";
  if (/^jsonb?/.test(column.type)) return "'{}'";
  return seedKey;
};

export const seedSql = (owned: readonly OwnedTable[], users: readonly string[]): string => {
  const authUsers = owned.some(({ owner }) => owner.references === "auth.users")
    ? [
        `insert into auth.users (id) values ${users.map((user) => `(${literal(user)})`).join(", ")} on conflict do nothing;`,
      ]
    : [];
  const inserts = owned.flatMap(({ table, owner }) =>
    users.map((user, index) => {
      const columns = [owner, ...table.columns.filter((column) => column.required && column.name !== owner.name)];
      const values = columns.map((column) =>
        column.name === owner.name ? ownerValue(column, user, index) : placeholder(column, table.name, user, index),
      );
      return `insert into ${qualified(table.name)} (${columns.map((column) => quoted(column.name)).join(", ")}) values (${values.join(", ")});`;
    }),
  );
  return [...authUsers, ...inserts, ""].join("\n");
};

export const countSql = (asUser: string, user: string, owned: OwnedTable, value: string): string =>
  [
    "begin;",
    `${asUser.replaceAll("{user}", user.replace(/'/g, "''"))};`,
    `select 'fm-count:' || count(*) from ${qualified(owned.table.name)} where ${quoted(owned.owner.name)} = ${value};`,
    "rollback;",
    "",
  ].join("\n");

export interface SqlPlaces {
  readonly root: AbsolutePath;
  readonly deadline: number;
}

const runner = (runtime: Runtime, url: string, places: SqlPlaces) => (command: string, input?: string) => {
  const result = runtime.exec({
    command,
    args: [],
    cwd: places.root,
    shell: true,
    timeoutMs: Math.max(1_000, Math.min(STEP_TIMEOUT_MS, places.deadline - nowMs(runtime))),
    env: { DATABASE_URL: url, FINITEMONKEY_THROWAWAY: "1", CI: "1" },
    unset: ["NODE_TEST_CONTEXT"],
    ...(input === undefined ? {} : { input }),
  });
  const ok = result.found && result.exitCode === 0 && !result.timedOut;
  return { ok, stdout: result.stdout, detail: (result.stderr || result.stdout).trim().slice(-DETAIL_LIMIT) };
};

export type SqlDbResult =
  | { readonly kind: "db"; readonly db: RowDb }
  | { readonly kind: "not_configured" }
  | { readonly kind: "refused"; readonly url: string };

export const sqlDb = (runtime: Runtime, migrate: MigrateConfig, config: RowsConfig, places: SqlPlaces): SqlDbResult => {
  const { url, apply, reset } = migrate;
  if (url === undefined || apply === undefined) return { kind: "not_configured" };
  if (!isLocalDatabase(url)) return { kind: "refused", url };
  const run = runner(runtime, url, places);
  const custom =
    config.seed === undefined ? undefined : runtime.readText(toAbsolutePath(join(places.root, config.seed)));
  return {
    kind: "db",
    db: {
      prepare: () => {
        for (const [name, command] of [
          ["reset", reset],
          ["apply", apply],
        ] as const) {
          if (command === undefined) continue;
          const step = run(command);
          if (!step.ok) return `${name}: ${step.detail}`;
        }
        return undefined;
      },
      seed: (owned, users) => {
        if (custom !== undefined && !custom.ok) return `seed: cannot read ${config.seed ?? ""}`;
        const step = run(config.sql, custom?.ok === true ? custom.value : seedSql(owned, users));
        return step.ok ? undefined : `seed: ${step.detail}`;
      },
      count: (user, owned, value) => {
        const target = ownerValue(owned.owner, value, value === config.userA ? 0 : 1);
        const step = run(config.sql, countSql(config.asUser, user, owned, target));
        const match = step.ok ? COUNT.exec(step.stdout) : null;
        return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
      },
    },
  };
};

export const runRowScenarios = (runtime: Runtime, root: AbsolutePath, deadline: number): RowsRun => {
  const tree = loadProjectConfig(runtime, root);
  const config = rowsConfig(tree);
  const owned = ownedTables(scanTables(runtime, root, config), config);
  if (owned.length === 0) return { kind: "none" };
  const made = sqlDb(runtime, migrateConfig(tree), config, { root, deadline });
  return made.kind === "db" ? runRows(owned, config, made.db) : made;
};
