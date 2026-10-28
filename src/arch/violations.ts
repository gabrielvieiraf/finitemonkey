import { matchesAny } from "../core/glob.js";
import type { ArchConfig, Layer } from "./config.js";
import type { ImportEdge } from "./imports.js";

export const ARCH_RULES = ["forbidden", "not_allowed", "private"] as const;

export type ArchRule = (typeof ARCH_RULES)[number];

export interface ArchViolation {
  readonly rule: ArchRule;
  readonly from: string;
  readonly line: number;
  readonly to: string;
  readonly fromLayer: string;
  readonly toLayer: string;
  readonly hint: string;
}

export const layerOf = (config: ArchConfig, path: string): Layer | undefined =>
  config.layers.find((layer) => matchesAny(path, layer.paths));

const edgeViolation = (config: ArchConfig, edge: ImportEdge): ArchViolation | undefined => {
  const source = layerOf(config, edge.from);
  const target = layerOf(config, edge.to);
  if (source === undefined || target === undefined || source.name === target.name) return undefined;
  const base = { from: edge.from, line: edge.line, to: edge.to, fromLayer: source.name, toLayer: target.name };
  const forbidden = config.forbid.find((rule) => rule.from === source.name && rule.to === target.name);
  if (forbidden !== undefined) return { ...base, rule: "forbidden", hint: forbidden.message };
  if (source.allow !== undefined && !source.allow.includes(target.name)) {
    return { ...base, rule: "not_allowed", hint: source.allow.join(", ") };
  }
  if (target.public !== undefined && !matchesAny(edge.to, target.public)) {
    return { ...base, rule: "private", hint: target.public.join(", ") };
  }
  return undefined;
};

export const archViolations = (config: ArchConfig, edges: readonly ImportEdge[]): readonly ArchViolation[] =>
  edges.flatMap((edge) => edgeViolation(config, edge) ?? []);

export const violationFingerprint = (violation: ArchViolation): string =>
  `${violation.rule}\u0000${violation.from}\u0000${violation.to}`;
