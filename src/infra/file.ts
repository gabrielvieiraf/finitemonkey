import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import type { YamlValue } from "../core/yaml/scalar.js";
import { stringifyYaml } from "../core/yaml/write.js";
import {
  type DeployLevel,
  type HostEntry,
  type InfraTarget,
  type Inventory,
  isDeployLevel,
  RISK_FIX,
} from "./types.js";

export const INFRA_FILE = ".finitemonkey/infra.yml";
export const HOSTS_FILE = ".finitemonkey/hosts.local.yml";
export const INFRA_SCHEMA = "finitemonkey/infra@1";
const HEADER = [
  "# Written by finitemonkey infra. No host, IP or secret goes here:",
  "# real addresses live in .finitemonkey/hosts.local.yml, which git ignores.",
];

export type LevelSource = "detected" | "confirmed";

export interface LevelRecord {
  readonly level: DeployLevel;
  readonly source: LevelSource;
  readonly decision?: string;
}

export const infraPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, INFRA_FILE));
export const hostsPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, HOSTS_FILE));

const readYaml = (runtime: Pick<Runtime, "readText">, path: AbsolutePath): JsonObject | undefined => {
  const text = runtime.readText(path);
  if (!text.ok) return undefined;
  const parsed = parseYaml(text.value);
  return parsed.ok && isRecord(parsed.value) ? parsed.value : undefined;
};

export const readInfraText = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): string | undefined => {
  const text = runtime.readText(infraPath(root));
  return text.ok ? text.value : undefined;
};

export const readInfra = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): JsonObject | undefined =>
  readYaml(runtime, infraPath(root));

export const readLevel = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): LevelRecord | undefined => {
  const data = readInfra(runtime, root);
  const level = data?.["level"];
  if (!isDeployLevel(level)) return undefined;
  const decision = data?.["level_decision"];
  return {
    level,
    source: data?.["level_source"] === "confirmed" ? "confirmed" : "detected",
    ...(typeof decision === "string" && decision !== "" ? { decision } : {}),
  };
};

const targetYaml = (target: InfraTarget): YamlValue => ({
  type: target.type,
  trigger: target.trigger,
  build_location: target.buildLocation,
  artifact: target.artifact,
  migration: target.migration,
  health: target.health,
  rollback: target.rollback,
  waits_for_ci: target.waitsForCi,
  hosts: [...target.hosts],
});

const patternsYaml = (inventory: Inventory): YamlValue => {
  const byPattern = new Map<string, string[]>();
  for (const hit of inventory.hits) byPattern.set(hit.pattern, [...(byPattern.get(hit.pattern) ?? []), hit.file]);
  return [...byPattern.entries()].map(([id, files]) => ({ id, files: [...new Set(files)] }));
};

export const infraYaml = (
  inventory: Inventory,
  level: LevelRecord,
  extra: Readonly<Record<string, YamlValue>> = {},
): string => {
  const body: Record<string, YamlValue> = {
    schema: INFRA_SCHEMA,
    level: level.level,
    level_source: level.source,
    ...(level.decision === undefined ? {} : { level_decision: level.decision }),
    detected_level: inventory.level,
    patterns: patternsYaml(inventory),
    targets: inventory.targets.map(targetYaml),
    risks: inventory.risks.map((risk) => ({
      id: risk.id,
      severity: risk.severity,
      at: `${risk.file}:${String(risk.line)}`,
      fix: RISK_FIX[risk.id],
    })),
    conflicts: [...inventory.conflicts],
    ...extra,
  };
  return `${HEADER.join("\n")}\n${stringifyYaml(body)}`;
};

export const hostsYaml = (hosts: readonly HostEntry[]): string =>
  `# Local only: production addresses found by finitemonkey infra. Do not commit.\n${stringifyYaml(
    Object.fromEntries(
      hosts.map((entry) => [
        entry.alias,
        {
          host: entry.host,
          ...(entry.user === undefined ? {} : { user: entry.user }),
          source: `${entry.file}:${String(entry.line)}`,
        },
      ]),
    ),
  )}`;

const hostEntry = (alias: string, value: unknown): HostEntry | undefined => {
  if (!isRecord(value) || typeof value["host"] !== "string") return undefined;
  const user = value["user"];
  const [file = "", line = "0"] = typeof value["source"] === "string" ? value["source"].split(/:(?=\d+$)/) : [];
  return {
    alias,
    host: value["host"],
    ...(typeof user === "string" && user !== "" ? { user } : {}),
    file,
    line: Number.parseInt(line, 10) || 0,
  };
};

export const readHosts = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): readonly HostEntry[] => {
  const data = readYaml(runtime, hostsPath(root));
  if (data === undefined) return [];
  return Object.entries(data).flatMap(([alias, value]) => hostEntry(alias, value) ?? []);
};
