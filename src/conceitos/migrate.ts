import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { judgePath, prependEntries, readEntries } from "../judge/store.js";
import { profileFromLog, profileRecords } from "../perfil/log.js";
import {
  PERFIL_DERIVED,
  type ProfileRuntime,
  readLegacyProfile,
  readProfile,
  rebuildProfile,
} from "../perfil/store.js";
import { FM_DIR, type FmPaths } from "../task/paths.js";
import { CONCEPT_EVENTS_FILE, readConceptEvents, readLegacyEvents } from "./evidence.js";
import { conceitosLog, evidenceRecord, MIGRATED_REF } from "./judge-log.js";

export const CONCEITOS_MIGRATE_SCHEMA = "finitemonkey/conceitos-migrate@1";

export interface MigrationFile {
  readonly file: string;
  readonly entries: number;
}

export interface MigrationPlan {
  readonly files: readonly MigrationFile[];
  readonly records: readonly JsonObject[];
}

export type MigrationRuntime = ProfileRuntime & Pick<Runtime, "writeAtomic" | "remove">;

export type MigrationOutcome = "none" | "converted" | "mismatch" | "write_failed";

const conceptPart = (runtime: Pick<Runtime, "readText">, paths: FmPaths, migrated: boolean): MigrationPlan => {
  const legacy = migrated ? [] : readLegacyEvents(runtime, paths);
  if (legacy.length === 0) return { files: [], records: [] };
  return {
    files: [{ file: `${FM_DIR}/${CONCEPT_EVENTS_FILE}`, entries: legacy.length }],
    records: legacy.map((event, index) => evidenceRecord(event, index, MIGRATED_REF)),
  };
};

const profilePart = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths, logged: boolean): MigrationPlan => {
  const legacy = logged ? undefined : readLegacyProfile(runtime, paths);
  if (legacy === undefined) return { files: [], records: [] };
  const records = profileRecords(legacy.updatedAt, undefined, legacy);
  return { files: [{ file: PERFIL_DERIVED, entries: records.length }], records };
};

export const planMigration = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths): MigrationPlan => {
  const entries = readEntries(runtime, paths);
  const concepts = conceptPart(runtime, paths, conceitosLog(entries).migrated);
  const profile = profilePart(runtime, paths, profileFromLog(entries) !== undefined);
  return { files: [...concepts.files, ...profile.files], records: [...concepts.records, ...profile.records] };
};

const golden = (runtime: Pick<Runtime, "readText" | "now">, paths: FmPaths): string => {
  const profile = readProfile(runtime, paths);
  return JSON.stringify({
    events: readConceptEvents(runtime, paths),
    profile: profile === undefined ? null : { domains: profile.domains, quickStart: profile.quickStart },
  });
};

export const applyMigration = (runtime: MigrationRuntime, paths: FmPaths, plan: MigrationPlan): MigrationOutcome => {
  if (plan.records.length === 0) return "none";
  const before = golden(runtime, paths);
  const original = runtime.readText(judgePath(paths));
  if (!prependEntries(runtime, paths, plan.records)) return "write_failed";
  if (golden(runtime, paths) !== before) {
    if (original.ok) runtime.writeAtomic(judgePath(paths), original.value);
    else runtime.remove(judgePath(paths));
    return "mismatch";
  }
  rebuildProfile(runtime, paths);
  return "converted";
};
