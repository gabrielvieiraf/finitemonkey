import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../src/core/parsed.js";

export const EXPECTATIONS = ["block", "allow"] as const;
export const ORIGINS = ["synthetic", "session"] as const;

export type Expectation = (typeof EXPECTATIONS)[number];
export type Origin = (typeof ORIGINS)[number];

export interface CorpusCase {
  readonly id: string;
  readonly guard: string;
  readonly expect: Expectation;
  readonly tool: string;
  readonly input: JsonObject;
  readonly files: Readonly<Record<string, string>>;
  readonly staged: readonly string[];
  readonly payload: JsonObject;
  readonly origin: Origin;
  readonly note: string;
}

export const CASES_FILE = "cases.jsonl";

const filesOf = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([, text]) => typeof text !== "string")) return undefined;
  return Object.fromEntries(entries.flatMap(([path, text]) => (typeof text === "string" ? [[path, text]] : [])));
};

export const parseCase = (record: JsonObject, guard: string): Parsed<CorpusCase> => {
  const { id, tool, note } = record;
  if (typeof id !== "string" || id === "") return reject(`${guard}: a case has no id`);
  const expect = EXPECTATIONS.find((option) => option === record["expect"]);
  if (expect === undefined) return reject(`${guard}/${id}: expect must be block or allow`);
  const origin = ORIGINS.find((option) => option === (record["origin"] ?? "synthetic"));
  if (origin === undefined) return reject(`${guard}/${id}: origin must be synthetic or session`);
  if (typeof tool !== "string" || tool === "") return reject(`${guard}/${id}: tool is required`);
  const input = record["input"];
  if (!isRecord(input)) return reject(`${guard}/${id}: input must be an object`);
  const files = filesOf(record["files"]);
  if (files === undefined) return reject(`${guard}/${id}: files must map paths to text`);
  const staged = record["staged"] ?? [];
  if (!Array.isArray(staged) || !staged.every((path) => typeof path === "string" && path in files)) {
    return reject(`${guard}/${id}: staged must list paths from files`);
  }
  const payload = record["payload"] ?? {};
  if (!isRecord(payload)) return reject(`${guard}/${id}: payload must be an object`);
  return accept({
    id,
    guard,
    expect,
    tool,
    input,
    files,
    staged,
    payload,
    origin,
    note: typeof note === "string" ? note : "",
  });
};

export const parseCases = (text: string, guard: string): Parsed<readonly CorpusCase[]> => {
  const cases: CorpusCase[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const record = parseJsonObject(line);
    if (!record.ok) return reject(`${guard} line ${String(index + 1)}: ${record.error}`);
    const parsed = parseCase(record.value, guard);
    if (!parsed.ok) return reject(parsed.error);
    cases.push(parsed.value);
  }
  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) return reject(`${guard}: duplicate case id ${item.id}`);
    seen.add(item.id);
  }
  return accept(cases);
};

export const loadCorpus = (root: string): Parsed<Readonly<Record<string, readonly CorpusCase[]>>> => {
  if (!existsSync(root)) return accept({});
  const corpus: Record<string, readonly CorpusCase[]> = {};
  for (const guard of readdirSync(root).sort()) {
    const file = join(root, guard, CASES_FILE);
    if (!existsSync(file)) continue;
    const cases = parseCases(readFileSync(file, "utf8"), guard);
    if (!cases.ok) return reject(cases.error);
    corpus[guard] = cases.value;
  }
  return accept(corpus);
};

const PLACEHOLDER = /\{\{sample:([A-Za-z][A-Za-z0-9]*)\}\}/g;

export const expandText = (text: string, samples: Readonly<Record<string, string>>): Parsed<string> => {
  const unknown = [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "").filter((name) => !(name in samples));
  if (unknown.length > 0) return reject(`unknown sample ${unknown.join(", ")}`);
  return accept(text.replace(PLACEHOLDER, (_whole, name: string) => samples[name] ?? ""));
};

const expandValue = (value: unknown, samples: Readonly<Record<string, string>>): Parsed<unknown> => {
  if (typeof value === "string") return expandText(value, samples);
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const expanded = expandValue(item, samples);
      if (!expanded.ok) return expanded;
      items.push(expanded.value);
    }
    return accept(items);
  }
  if (!isRecord(value)) return accept(value);
  const entries: [string, unknown][] = [];
  for (const [key, item] of Object.entries(value)) {
    const expanded = expandValue(item, samples);
    if (!expanded.ok) return expanded;
    entries.push([key, expanded.value]);
  }
  return accept(Object.fromEntries(entries));
};

export const expandCase = (item: CorpusCase, samples: Readonly<Record<string, string>>): Parsed<CorpusCase> => {
  const input = expandValue(item.input, samples);
  const files = expandValue(item.files, samples);
  if (!input.ok) return reject(`${item.guard}/${item.id}: ${input.error}`);
  if (!files.ok) return reject(`${item.guard}/${item.id}: ${files.error}`);
  const expandedInput = input.value;
  const expandedFiles = filesOf(files.value);
  if (!isRecord(expandedInput) || expandedFiles === undefined) return reject(`${item.guard}/${item.id}: bad shape`);
  return accept({ ...item, input: expandedInput, files: expandedFiles });
};
