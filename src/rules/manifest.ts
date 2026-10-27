import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, type Parsed, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

export const MANIFEST_FILE = ".finitemonkey/rules-compiled.json";
export const SURFACES = ["guard", "config", "git", "ci", "text"] as const;

export type Surface = (typeof SURFACES)[number];

export interface CompiledRule {
  readonly surfaces: readonly Surface[];
  readonly deny: readonly string[];
  readonly settings: JsonObject;
}

export interface Manifest {
  readonly schemaVersion: 1;
  readonly rules: Readonly<Record<string, CompiledRule>>;
  readonly presenceHook: boolean;
  readonly workflow: string | undefined;
}

export const EMPTY_MANIFEST: Manifest = { schemaVersion: 1, rules: {}, presenceHook: false, workflow: undefined };

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const compiledOf = (value: unknown): CompiledRule | undefined => {
  if (!isRecord(value)) return undefined;
  const settings = value["settings"];
  return {
    surfaces: strings(value["surfaces"]).filter((item): item is Surface =>
      SURFACES.some((surface) => surface === item),
    ),
    deny: strings(value["deny"]),
    settings: isRecord(settings) ? settings : {},
  };
};

export const readManifest = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): Manifest => {
  const text = runtime.readText(toAbsolutePath(MANIFEST_FILE, root));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return EMPTY_MANIFEST;
  const rules = isRecord(parsed.value["rules"]) ? parsed.value["rules"] : {};
  const workflow = parsed.value["workflow"];
  return {
    schemaVersion: 1,
    rules: Object.fromEntries(
      Object.entries(rules).flatMap(([id, value]): [string, CompiledRule][] => {
        const compiled = compiledOf(value);
        return compiled === undefined ? [] : [[id, compiled]];
      }),
    ),
    presenceHook: parsed.value["presenceHook"] === true,
    workflow: typeof workflow === "string" ? workflow : undefined,
  };
};

export const writeManifest = (
  runtime: Pick<Runtime, "writeText">,
  root: AbsolutePath,
  manifest: Manifest,
): Parsed<true> => runtime.writeText(toAbsolutePath(MANIFEST_FILE, root), `${JSON.stringify(manifest, null, 2)}\n`);
