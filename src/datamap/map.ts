import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml, type YamlValue } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { isPersonalField } from "./personal.js";
import { isSchemaCandidate, type SchemaField, schemaFieldsIn } from "./schema.js";

export const DATA_MAP_FILE = ".finitemonkey/data-map.yml";

export interface DataMapRow {
  readonly field: string;
  readonly legalBasis: string;
  readonly retention: string;
  readonly deletedIn: string;
  readonly ai: string;
}

export type MapRuntime = Pick<Runtime, "git" | "readText">;

const text = (record: Readonly<Record<string, YamlValue>>, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

export const readDataMap = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): readonly DataMapRow[] => {
  const raw = runtime.readText(toAbsolutePath(DATA_MAP_FILE, root));
  if (!raw.ok) return [];
  const parsed = parseYaml(raw.value);
  const tree = parsed.ok ? parsed.value : undefined;
  const list = isRecord(tree) ? tree["fields"] : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: YamlValue): DataMapRow[] => {
    if (!isRecord(item) || typeof item["field"] !== "string") return [];
    return [
      {
        field: item["field"],
        legalBasis: text(item, "legalBasis"),
        retention: text(item, "retention"),
        deletedIn: text(item, "deletedIn"),
        ai: text(item, "ai"),
      },
    ];
  });
};

export const isComplete = (row: DataMapRow): boolean =>
  row.legalBasis !== "" && row.retention !== "" && row.deletedIn !== "";

export const keyOf = (field: Pick<SchemaField, "model" | "field">): string => `${field.model}.${field.field}`;

export const personalFields = (runtime: MapRuntime, root: AbsolutePath): readonly SchemaField[] => {
  const listed = runtime.git(["ls-files", "--cached", "--others", "--exclude-standard"], root);
  const files = listed.found && listed.ok ? listed.stdout.split("\n").filter(isSchemaCandidate) : [];
  return files
    .filter((file) => !file.split("/").includes("node_modules"))
    .flatMap((file) => {
      const read = runtime.readText(toAbsolutePath(file, root));
      return read.ok ? schemaFieldsIn(file, read.value) : [];
    })
    .filter((field) => isPersonalField(field.model, field.field));
};

export const mergedRows = (fields: readonly SchemaField[], rows: readonly DataMapRow[]): readonly DataMapRow[] => {
  const known = new Set(rows.map((row) => row.field));
  const added = [...new Set(fields.map(keyOf))]
    .filter((key) => !known.has(key))
    .map((field) => ({ field, legalBasis: "", retention: "", deletedIn: "", ai: "" }));
  return [...rows, ...added];
};

export const dataMapYaml = (rows: readonly DataMapRow[]): string =>
  `# finitemonkey data map: one row per personal field. Fill legalBasis, retention and deletedIn;\n# ai records the decision before a field is sent to an AI provider.\n${stringifyYaml(
    {
      schemaVersion: 1,
      fields: rows.map((row) => ({ ...row })),
    },
  )}`;
