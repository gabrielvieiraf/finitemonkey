import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { accept, isRecord, type JsonObject, type Parsed, reject } from "../src/core/parsed.js";
import { maskSession } from "./bench-corpus-mask.js";
import { CASES_FILE, parseCase, parseCases } from "./evidence-corpus.js";

export interface SessionCaseOptions {
  readonly guard: string;
  readonly expect: string;
  readonly id: string;
  readonly note: string;
  readonly roots: readonly string[];
}

const SECRET_MASK = "«secret:";

export const sessionRoots = (payload: JsonObject, extra: readonly string[]): readonly string[] =>
  [...(typeof payload["cwd"] === "string" ? [payload["cwd"]] : []), ...extra]
    .filter((root) => root.length > 1)
    .sort((left, right) => right.length - left.length);

export const buildSessionCase = (payload: JsonObject, options: SessionCaseOptions): Parsed<JsonObject> => {
  const tool = payload["tool_name"];
  const input = payload["tool_input"];
  if (typeof tool !== "string" || !isRecord(input)) {
    return reject("the session file must be a PreToolUse payload with tool_name and tool_input");
  }
  const masked = maskSession(input, options.roots);
  const record: JsonObject = {
    id: options.id,
    expect: options.expect,
    tool,
    input: isRecord(masked) ? masked : {},
    origin: "session",
    note: maskSession(options.note, options.roots),
  };
  const parsed = parseCase(record, options.guard);
  return parsed.ok ? accept(record) : reject(parsed.error);
};

export const maskedSecret = (record: JsonObject): boolean => JSON.stringify(record).includes(SECRET_MASK);

export const appendSessionCase = (corpusDir: string, guard: string, record: JsonObject): Parsed<string> => {
  const dir = join(corpusDir, guard);
  const file = join(dir, CASES_FILE);
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = JSON.stringify(record);
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const checked = parseCases(`${before}${lead}${line}\n`, guard);
  if (!checked.ok) return reject(checked.error);
  mkdirSync(dir, { recursive: true });
  appendFileSync(file, `${lead}${line}\n`);
  return accept(file);
};
