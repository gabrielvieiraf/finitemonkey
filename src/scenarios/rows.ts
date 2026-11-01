import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, type ConfigTree } from "../git/project-config.js";
import { type Column, OWNER_COLUMNS, ownerColumn, parseMigrations, type Table } from "./policies.js";

export const USER_A_ID = "00000000-0000-4000-8000-00000000000a";
export const USER_B_ID = "00000000-0000-4000-8000-00000000000b";
export const DEFAULT_AS_USER = [
  "set local role authenticated",
  `select set_config('request.jwt.claim.sub', '{user}', true), set_config('request.jwt.claims', '{"sub":"{user}","role":"authenticated"}', true), set_config('app.user_id', '{user}', true)`,
].join(";\n");
export const DEFAULT_SQL = 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -q';

const MIGRATION_DIR = /(?:^|\/)(?:supabase\/migrations|db\/migrations|prisma\/migrations|migrations)\//;
const SKIP = /(?:^|\/)(?:node_modules|\.git|dist|\.finitemonkey)\//;
const IDENTITY = /\b(?:auth\.uid|auth\.jwt|current_setting|current_user|session_user)\b/i;

export interface RowsConfig {
  readonly userA: string;
  readonly userB: string;
  readonly asUser: string;
  readonly sql: string;
  readonly seed: string | undefined;
  readonly owners: readonly string[];
  readonly migrations: readonly string[];
}

export interface OwnedTable {
  readonly table: Table;
  readonly owner: Column;
}

export type RowFindingKind = "rls_off" | "policy_open";

export interface RowFinding {
  readonly table: string;
  readonly kind: RowFindingKind;
  readonly policy?: string;
}

export type RowKind = "owner_reads" | "other_reads";

export interface RowResult {
  readonly id: string;
  readonly kind: RowKind;
  readonly table: string;
  readonly actor: "A" | "B";
  readonly allowed: boolean;
  readonly count: number;
  readonly passed: boolean;
}

export type RowsRun =
  | { readonly kind: "none" }
  | { readonly kind: "not_configured" }
  | { readonly kind: "refused"; readonly url: string }
  | { readonly kind: "unavailable"; readonly step: string; readonly detail: string }
  | { readonly kind: "ran"; readonly results: readonly RowResult[] };

export interface RowDb {
  readonly prepare: () => string | undefined;
  readonly seed: (owned: readonly OwnedTable[], users: readonly string[]) => string | undefined;
  readonly count: (user: string, owned: OwnedTable, ownerValue: string) => number | undefined;
}

const text = (tree: ConfigTree, key: string, fallback: string): string => {
  const value = configAt(tree, "access", key);
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
};

export const rowsConfig = (tree: ConfigTree): RowsConfig => {
  const owners = configList(tree, "access", "owner_columns");
  const seed = text(tree, "seed", "");
  return {
    userA: text(tree, "db_user_a", USER_A_ID),
    userB: text(tree, "db_user_b", USER_B_ID),
    asUser: text(tree, "db_as_user", DEFAULT_AS_USER),
    sql: text(tree, "sql", DEFAULT_SQL),
    seed: seed === "" ? undefined : seed,
    owners: owners.length > 0 ? owners : OWNER_COLUMNS,
    migrations: configList(tree, "access", "migrations"),
  };
};

const isMigration = (file: string, dirs: readonly string[]): boolean =>
  file.endsWith(".sql") &&
  !SKIP.test(`/${file}`) &&
  (dirs.length === 0
    ? MIGRATION_DIR.test(`/${file}`)
    : dirs.some((dir) => file.startsWith(`${dir.replace(/\/$/, "")}/`)));

export const migrationFiles = (
  runtime: Pick<Runtime, "walkFiles">,
  root: AbsolutePath,
  config: RowsConfig,
): readonly string[] => {
  const files = runtime.walkFiles(root);
  return files.ok
    ? files.value
        .map((file) => file.replaceAll("\\", "/"))
        .filter((file) => isMigration(file, config.migrations))
        .sort()
    : [];
};

export const scanTables = (
  runtime: Pick<Runtime, "walkFiles" | "readText">,
  root: AbsolutePath,
  config: RowsConfig,
): readonly Table[] =>
  parseMigrations(
    migrationFiles(runtime, root, config).flatMap((file) => {
      const read = runtime.readText(toAbsolutePath(join(root, file)));
      return read.ok ? [read.value] : [];
    }),
  );

export const ownedTables = (tables: readonly Table[], config: Pick<RowsConfig, "owners">): readonly OwnedTable[] =>
  tables.flatMap((table) => {
    const owner = ownerColumn(table, config.owners);
    return owner === undefined ? [] : [{ table, owner }];
  });

export const isOpenPolicy = (using: string, owner: string): boolean =>
  /^\(*\s*true\s*\)*$/i.test(using.trim()) || !(IDENTITY.test(using) || new RegExp(`\\b${owner}\\b`, "i").test(using));

export const rowFindings = (owned: readonly OwnedTable[]): readonly RowFinding[] =>
  owned.flatMap(({ table, owner }): RowFinding[] => {
    if (!table.rls) return [{ table: table.name, kind: "rls_off" }];
    return table.policies
      .filter(
        (policy) => (policy.command === "select" || policy.command === "all") && isOpenPolicy(policy.using, owner.name),
      )
      .map((policy) => ({ table: table.name, kind: "policy_open", policy: policy.name }));
  });

const result = (owned: OwnedTable, kind: RowKind, count: number): RowResult => {
  const allowed = kind === "owner_reads";
  return {
    id: `${owned.table.name}.${kind}`,
    kind,
    table: owned.table.name,
    actor: allowed ? "A" : "B",
    allowed,
    count,
    passed: allowed ? count > 0 : count === 0,
  };
};

export const runRows = (owned: readonly OwnedTable[], config: RowsConfig, db: RowDb): RowsRun => {
  if (owned.length === 0) return { kind: "none" };
  const prepared = db.prepare();
  if (prepared !== undefined) return { kind: "unavailable", step: "apply", detail: prepared };
  const seeded = db.seed(owned, [config.userA, config.userB]);
  if (seeded !== undefined) return { kind: "unavailable", step: "seed", detail: seeded };
  const results: RowResult[] = [];
  for (const table of owned) {
    const own = db.count(config.userA, table, config.userA);
    const other = db.count(config.userB, table, config.userA);
    if (own === undefined || other === undefined)
      return { kind: "unavailable", step: "read", detail: `could not read ${table.table.name} as a user` };
    results.push(result(table, "owner_reads", own), result(table, "other_reads", other));
  }
  return { kind: "ran", results };
};
