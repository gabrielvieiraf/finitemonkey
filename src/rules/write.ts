import { accept, type Parsed, reject } from "../core/parsed.js";
import type { YamlValue } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { PRESET_RULES } from "./preset.js";
import type { Proposal } from "./propose.js";
import { parseRules, type ProjectRule, type RuleScope } from "./types.js";

const scopeYaml = (scope: RuleScope): Readonly<Record<string, YamlValue>> =>
  Object.fromEntries(
    (["paths", "tools", "words"] as const).flatMap((key) => (scope[key].length === 0 ? [] : [[key, [...scope[key]]]])),
  );

const detectorYaml = (proposal: Proposal): YamlValue | undefined => {
  const detector = proposal.detector;
  if (detector === undefined || detector === "attribution") return detector;
  return Object.fromEntries(
    Object.entries(detector).map(([key, value]): [string, YamlValue] => [
      key,
      Array.isArray(value) ? value.map(String) : String(value),
    ]),
  );
};

export const entryOf = (proposal: Proposal): Readonly<Record<string, YamlValue>> => {
  const detector = detectorYaml(proposal);
  const scope = scopeYaml(proposal.scope);
  return {
    id: proposal.id,
    text: proposal.text,
    origin: proposal.origin,
    severity: proposal.severity,
    bucket: proposal.bucket,
    ...(detector === undefined ? {} : { detector }),
    ...(Object.keys(scope).length === 0 ? {} : { scope }),
  };
};

const RULES_KEY = /^rules:\s*(#.*)?$/;

const blockEnd = (lines: readonly string[], start: number): number => {
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[^\s#-]/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  while (end > start + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return end;
};

const itemIndent = (lines: readonly string[], start: number, end: number): string =>
  /^(\s*)- /.exec(lines.slice(start + 1, end).find((line) => /^\s*- /.test(line)) ?? "")?.[1] ?? "  ";

const reindent = (yaml: string, indent: string): readonly string[] =>
  yaml
    .split("\n")
    .slice(1)
    .filter((line) => line !== "")
    .map((line) => `${indent}${line.slice(2)}`);

const countOf = (current: string | undefined): number | undefined => {
  if (!current?.split("\n").some((line) => RULES_KEY.test(line))) return 0;
  const parsed = parseRules(current, PRESET_RULES);
  return parsed.ok ? parsed.value.length : undefined;
};

const verified = (text: string, check: (rules: readonly ProjectRule[]) => boolean): Parsed<string> => {
  const parsed = parseRules(text, PRESET_RULES);
  if (!parsed.ok) return reject(parsed.error);
  return check(parsed.value) ? accept(text) : reject("rules.yml did not take the change");
};

export const withNewRules = (current: string | undefined, proposals: readonly Proposal[]): Parsed<string> => {
  const entries = proposals.map(entryOf);
  const count = countOf(current);
  if (count === undefined) return reject("rules.yml does not parse; fix it before adding rules");
  if (entries.length === 0) return accept(current ?? "");
  const wanted = (rules: readonly ProjectRule[]): boolean => rules.length === count + entries.length;
  const yaml = stringifyYaml({ rules: entries });
  const text = (current ?? "").replace(/\s+$/, "");
  const lines = text.split("\n");
  const start = lines.findIndex((line) => RULES_KEY.test(line));
  if (start < 0) return verified(`${text === "" ? "" : `${text}\n`}${yaml}`, wanted);
  const end = blockEnd(lines, start);
  const added = reindent(yaml, itemIndent(lines, start, end));
  return verified(`${[...lines.slice(0, end), ...added, ...lines.slice(end)].join("\n")}\n`, wanted);
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

const itemRange = (
  lines: readonly string[],
  id: string,
): { start: number; end: number; indent: number } | undefined => {
  const pattern = new RegExp(`^\\s*(- )?id:\\s*["']?${id}["']?\\s*$`);
  const at = lines.findIndex((line) => pattern.test(line));
  if (at < 0) return undefined;
  let start = at;
  while (start > 0 && !/^\s*- /.test(lines[start] ?? "")) start -= 1;
  const indent = indentOf(lines[start] ?? "");
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() !== "" && indentOf(line) <= indent) break;
    end += 1;
  }
  return { start, end, indent };
};

const withoutFields = (lines: readonly string[], fieldIndent: number, keys: readonly string[]): readonly string[] => {
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const own = indentOf(line) === fieldIndent && keys.some((key) => line.trimStart().startsWith(`${key}:`));
    if (own) skipping = true;
    else if (skipping && (line.trim() === "" || indentOf(line) <= fieldIndent)) skipping = false;
    if (!own && !skipping) out.push(line);
  }
  return out;
};

export const withPromotion = (current: string, proposal: Proposal): Parsed<string> => {
  const lines = current.replace(/\s+$/, "").split("\n");
  const range = itemRange(lines, proposal.id);
  if (range === undefined) return reject(`rule ${proposal.id} is not in rules.yml`);
  const fieldIndent = range.indent + 2;
  const head = lines[range.start] ?? "";
  const body = withoutFields(lines.slice(range.start + 1, range.end), fieldIndent, ["bucket", "detector"]);
  const detector = detectorYaml(proposal);
  const added = [
    `${" ".repeat(fieldIndent)}bucket: ${proposal.bucket}`,
    ...(detector === undefined
      ? []
      : stringifyYaml({ detector })
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => `${" ".repeat(fieldIndent)}${line}`)),
  ];
  const next = [...lines.slice(0, range.start), head, ...body, ...added, ...lines.slice(range.end)];
  return verified(`${next.join("\n")}\n`, (rules) =>
    rules.some((rule) => rule.id === proposal.id && rule.bucket === proposal.bucket),
  );
};
