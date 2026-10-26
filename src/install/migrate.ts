import { compareSemver, parseSemver, type SemVer } from "../core/semver.js";
import { hashText } from "./hash.js";
import type { LockFile } from "./lock-file.js";
import type { Migration } from "./migrations/index.js";
import type { PlanItem } from "./plan.js";

export const pendingMigrations = (migrations: readonly Migration[], from: string, to: string): readonly Migration[] => {
  const low = parseSemver(from);
  const high = parseSemver(to);
  if (low === undefined || high === undefined) return [];
  return migrations
    .flatMap((migration): { readonly migration: Migration; readonly version: SemVer }[] => {
      const version = parseSemver(migration.version);
      return version === undefined ? [] : [{ migration, version }];
    })
    .filter(({ version }) => compareSemver(version, low) > 0 && compareSemver(version, high) <= 0)
    .sort((a, b) => compareSemver(a.version, b.version))
    .map(({ migration }) => migration);
};

const migrateItem = (item: PlanItem, previous: LockFile, steps: readonly ((text: string) => string)[]): PlanItem => {
  if (steps.length === 0 || item.before === undefined) return item;
  const migrated = steps.reduce((text, step) => step(text), item.after);
  if (migrated === item.after) return item;
  const recorded = previous.entries.find((entry) => entry.path === item.path)?.hash;
  if (recorded !== hashText(item.before)) {
    return { ...item, action: "keep-edited", after: item.before, proposal: migrated };
  }
  return { ...item, action: migrated === item.before ? "unchanged" : "update", after: migrated };
};

export const applyMigrations = (
  items: readonly PlanItem[],
  previous: LockFile | undefined,
  version: string,
  migrations: readonly Migration[],
): readonly PlanItem[] => {
  if (previous === undefined) return items;
  const pending = pendingMigrations(migrations, previous.version, version);
  if (pending.length === 0) return items;
  return items.map((item) =>
    migrateItem(
      item,
      previous,
      pending.flatMap((migration) =>
        migration.files.filter((file) => file.path === item.path).map((file) => file.migrate),
      ),
    ),
  );
};
