import { accept, isRecord, type JsonObject, type Parsed, reject } from "../core/parsed.js";
import { parseYaml } from "../core/yaml/parse.js";

export interface PlannedFront {
  readonly id: string;
  readonly goal: string;
  readonly contract: string | null;
  readonly paths: readonly string[];
  readonly append: readonly string[];
  readonly shared: readonly string[];
  readonly i18nNs: string | null;
  readonly port: number | null;
  readonly shotsPrefix: string | null;
  readonly blockedBy: readonly string[];
  readonly rename: boolean;
  readonly files: number | null;
  readonly issue: number | null;
}

export interface WavePlan {
  readonly wave: number;
  readonly size: string;
  readonly base: string | null;
  readonly maxConcurrent: number | null;
  readonly fronts: readonly PlannedFront[];
}

const str = (record: JsonObject, key: string): string | null => {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : null;
};

const num = (record: JsonObject, key: string): number | null => {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const frontOf = (value: unknown, index: number): PlannedFront => {
  const item = isRecord(value) ? value : {};
  const shared = isRecord(item["shared"]) ? item["shared"] : {};
  return {
    id: str(item, "id") ?? `F${String(index + 1)}`,
    goal: str(item, "goal") ?? "",
    contract: str(item, "contract"),
    paths: strings(item["paths"]),
    append: [...strings(item["append"]), ...strings(shared["append"])],
    shared: [...strings(item["shared_files"]), ...strings(shared["files"])],
    i18nNs: str(item, "i18n_ns") ?? str(shared, "i18n_ns"),
    port: num(item, "port"),
    shotsPrefix: str(item, "shots_prefix"),
    blockedBy: strings(item["blocked_by"]),
    rename: item["kind"] === "rename" || item["rename"] === true,
    files: num(item, "files"),
    issue: num(item, "issue"),
  };
};

export const parseWavePlan = (text: string): Parsed<WavePlan> => {
  const parsed = parseYaml(text);
  if (!parsed.ok) return reject(`line ${String(parsed.error.line)}: ${parsed.error.message}`);
  if (!isRecord(parsed.value)) return reject("expected a mapping with fronts");
  const root = parsed.value;
  const budget = isRecord(root["budget"]) ? root["budget"] : {};
  const list = Array.isArray(root["fronts"]) ? root["fronts"] : [];
  return accept({
    wave: num(root, "wave") ?? 1,
    size: str(root, "size") ?? "L",
    base: str(root, "base"),
    maxConcurrent: num(budget, "max_concurrent"),
    fronts: list.map((item: unknown, index) => frontOf(item, index)),
  });
};
