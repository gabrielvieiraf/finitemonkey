import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, parseConfigYaml } from "../git/project-config.js";
import { policyPath } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { DEFAULT_MAX_USD_PER_DAY, PROVIDER_KINDS, type ProviderKind } from "./kinds.js";

export const PROVIDER_FILE = "provider.json";
export const PROPOSALS_FILE = "provider-proposals.jsonl";
export const PROVIDER_SCHEMA = "finitemonkey/provider@1";

export interface EnabledKind {
  readonly kind: ProviderKind;
  readonly at: string;
  readonly by: string;
}

export const providerFile = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, PROVIDER_FILE));

export const proposalsFile = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, PROPOSALS_FILE));

export const enabledKinds = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly EnabledKind[] => {
  const kinds = readJsonFile(runtime, providerFile(paths))?.["kinds"];
  if (!isRecord(kinds)) return [];
  return PROVIDER_KINDS.flatMap((kind) => {
    const entry = kinds[kind];
    if (!isRecord(entry)) return [];
    const at = entry["at"];
    const by = entry["by"];
    return [{ kind, at: typeof at === "string" ? at : "", by: typeof by === "string" ? by : "" }];
  });
};

export const isEnabled = (runtime: Pick<Runtime, "readText">, paths: FmPaths, kind: ProviderKind): boolean =>
  enabledKinds(runtime, paths).some((entry) => entry.kind === kind);

export const setEnabled = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  kind: ProviderKind,
  by: string | undefined,
): boolean => {
  const rest = enabledKinds(runtime, paths).filter((entry) => entry.kind !== kind);
  const next = by === undefined ? rest : [...rest, { kind, at: runtime.now(), by }];
  const kinds = Object.fromEntries(next.map((entry) => [entry.kind, { at: entry.at, by: entry.by }]));
  return writeJsonFile(runtime, providerFile(paths), { schema: PROVIDER_SCHEMA, kinds }).ok;
};

export const maxUsdPerDay = (runtime: Pick<Runtime, "readText">, paths: FmPaths): number => {
  const text = runtime.readText(policyPath(paths.root));
  const raw = text.ok ? configAt(parseConfigYaml(text.value), "providers", "maxUsdPerDay") : undefined;
  const value = typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAX_USD_PER_DAY;
};
