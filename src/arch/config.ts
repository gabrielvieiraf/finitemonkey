import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type JsonObject, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";

export const ARCH_FILE = ".finitemonkey/arch.yml";
export const ARCH_FEATURE = "arch";

export interface Layer {
  readonly name: string;
  readonly paths: readonly string[];
  readonly allow?: readonly string[];
  readonly public?: readonly string[];
}

export interface Prohibition {
  readonly from: string;
  readonly to: string;
  readonly message: string;
}

export interface ArchConfig {
  readonly layers: readonly Layer[];
  readonly forbid: readonly Prohibition[];
}

type Issues = string[];

const texts = (value: unknown, at: string, issues: Issues): readonly string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) return value;
  issues.push(`${at}: must be a list of text`);
  return undefined;
};

const text = (record: JsonObject, key: string, at: string, issues: Issues): string => {
  const value = record[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  issues.push(`${at}.${key}: required text`);
  return "";
};

const layerOf = (value: unknown, index: number, issues: Issues): Layer | undefined => {
  const at = `layers[${String(index)}]`;
  if (!isRecord(value)) {
    issues.push(`${at}: must be a mapping`);
    return undefined;
  }
  const name = text(value, "name", at, issues);
  const paths = texts(value["paths"], `${at}.paths`, issues) ?? [];
  if (paths.length === 0) issues.push(`${at}.paths: list at least one glob`);
  const allow = texts(value["allow"], `${at}.allow`, issues);
  const exposed = texts(value["public"], `${at}.public`, issues);
  return {
    name,
    paths,
    ...(allow === undefined ? {} : { allow }),
    ...(exposed === undefined ? {} : { public: exposed }),
  };
};

const prohibitionOf = (value: unknown, index: number, issues: Issues): Prohibition | undefined => {
  const at = `forbid[${String(index)}]`;
  if (!isRecord(value)) {
    issues.push(`${at}: must be a mapping`);
    return undefined;
  }
  return {
    from: text(value, "from", at, issues),
    to: text(value, "to", at, issues),
    message: text(value, "message", at, issues),
  };
};

const listOf = <T>(
  value: unknown,
  key: string,
  issues: Issues,
  item: (v: unknown, i: number, x: Issues) => T | undefined,
): readonly T[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push(`${key}: must be a list`);
    return [];
  }
  return value.flatMap((entry: unknown, index) => item(entry, index, issues) ?? []);
};

const crossCheck = (config: ArchConfig, issues: Issues): void => {
  const names = new Set(config.layers.map((layer) => layer.name));
  const known = (name: string, at: string): void => {
    if (!names.has(name)) issues.push(`${at}: unknown layer "${name}"`);
  };
  for (const layer of config.layers) for (const name of layer.allow ?? []) known(name, `${layer.name}.allow`);
  for (const rule of config.forbid) {
    known(rule.from, "forbid.from");
    known(rule.to, "forbid.to");
  }
};

export const parseArch = (source: string): Parsed<ArchConfig, readonly string[]> => {
  const yaml = parseYaml(source);
  if (!yaml.ok) return reject([`line ${String(yaml.error.line)}: ${yaml.error.message}`]);
  if (!isRecord(yaml.value)) return reject(["arch.yml must be a mapping"]);
  const issues: Issues = [];
  const config = {
    layers: listOf(yaml.value["layers"], "layers", issues, layerOf),
    forbid: listOf(yaml.value["forbid"], "forbid", issues, prohibitionOf),
  };
  if (config.layers.length === 0) issues.push("layers: list at least one layer");
  crossCheck(config, issues);
  return issues.length === 0 ? accept(config) : reject(issues);
};

export const archPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, ARCH_FILE));

export type LoadedArch =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid"; readonly issues: readonly string[] }
  | { readonly kind: "ok"; readonly config: ArchConfig };

export const loadArch = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): LoadedArch => {
  const raw = runtime.readText(archPath(root));
  if (!raw.ok) return { kind: "absent" };
  const parsed = parseArch(raw.value);
  return parsed.ok ? { kind: "ok", config: parsed.value } : { kind: "invalid", issues: parsed.error };
};
