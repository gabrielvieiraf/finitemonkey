import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type JsonObject, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml, type YamlValue } from "../core/yaml/parse.js";

export const RULES_FILE = ".finitemonkey/rules.yml";
export const SEVERITIES = ["never", "must", "prefer"] as const;
export const TEXT_TARGETS = ["commit", "pr"] as const;

export type RuleSeverity = (typeof SEVERITIES)[number];
export type TextTarget = (typeof TEXT_TARGETS)[number];

export type Detector =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "path"; readonly path: string; readonly tools: readonly string[] }
  | { readonly kind: "text"; readonly pattern: string; readonly on: readonly TextTarget[] }
  | { readonly kind: "lint"; readonly lint: string }
  | { readonly kind: "check"; readonly check: string };

export interface ProjectRule {
  readonly id: string;
  readonly text: string;
  readonly origin: string;
  readonly severity: RuleSeverity;
  readonly detector: Detector | undefined;
  readonly settings: JsonObject | undefined;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const str = (record: JsonObject, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

const list = (value: unknown): readonly string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];

const detectorOf = (value: unknown): Detector | undefined => {
  if (!isRecord(value)) return undefined;
  const command = str(value, "command");
  if (command !== undefined) return { kind: "command", command };
  const path = str(value, "path");
  if (path !== undefined) {
    const tools = list(value["tool"]);
    return { kind: "path", path, tools: tools.length === 0 ? ["Write", "Edit", "MultiEdit", "NotebookEdit"] : tools };
  }
  const pattern = str(value, "text");
  if (pattern !== undefined) {
    const on = list(value["on"]).filter((item): item is TextTarget => item === "commit" || item === "pr");
    return { kind: "text", pattern, on: on.length === 0 ? ["commit", "pr"] : on };
  }
  const lint = str(value, "lint");
  if (lint !== undefined) return { kind: "lint", lint };
  const check = str(value, "check");
  return check === undefined ? undefined : { kind: "check", check };
};

const ruleOf = (value: YamlValue, index: number): Parsed<ProjectRule> => {
  if (!isRecord(value)) return reject(`rule ${String(index)} is not a map`);
  const id = str(value, "id");
  const text = str(value, "text");
  const severity = SEVERITIES.find((item) => item === value["severity"]);
  if (id === undefined || !ID.test(id))
    return reject(`rule ${String(index)} needs an id of lowercase letters, digits and dashes`);
  if (text === undefined) return reject(`rule ${id} needs a text`);
  if (severity === undefined) return reject(`rule ${id} needs severity never, must or prefer`);
  const settings = value["settings"];
  return accept({
    id,
    text,
    origin: str(value, "origin") ?? "",
    severity,
    detector: detectorOf(value["detector"]),
    settings: isRecord(settings) ? settings : undefined,
  });
};

export const parseRules = (source: string): Parsed<readonly ProjectRule[]> => {
  const parsed = parseYaml(source);
  if (!parsed.ok) return reject(`line ${String(parsed.error.line)}: ${parsed.error.message}`);
  const raw = isRecord(parsed.value) ? parsed.value["rules"] : undefined;
  if (!Array.isArray(raw)) return reject("rules must be a list");
  const rules: ProjectRule[] = [];
  const items: readonly YamlValue[] = raw;
  for (const [index, item] of items.entries()) {
    const rule = ruleOf(item, index);
    if (!rule.ok) return rule;
    if (rules.some((known) => known.id === rule.value.id)) return reject(`rule ${rule.value.id} appears twice`);
    rules.push(rule.value);
  }
  return accept(rules);
};

export const loadRules = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): Parsed<readonly ProjectRule[]> => {
  const text = runtime.readText(toAbsolutePath(RULES_FILE, root));
  return text.ok ? parseRules(text.value) : accept([]);
};
