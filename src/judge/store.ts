import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { parseEntry } from "./parse.js";
import { ENTRY_TYPES, JUDGE_FILE, JUDGE_SCHEMA, type JudgeEntry, type JudgeExport, oneOf } from "./types.js";

export const JUDGE_DIR = "judge";

export const REJECTIONS = [
  "unknown_type",
  "band_derived",
  "no_pointer",
  "not_a_decider",
  "wrong_decider",
  "no_handoff_target",
  "invalid",
  "write_failed",
] as const;

export type Rejection = (typeof REJECTIONS)[number];

export type Appended =
  { readonly ok: true; readonly entry: JudgeEntry } | { readonly ok: false; readonly reason: Rejection };

export const judgePath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, JUDGE_FILE));

export const judgeDir = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, JUDGE_DIR));

export const entryId = (prefix: string, ...parts: readonly string[]): string =>
  `${prefix}-${sha256Hex(parts.join("\u0000")).slice(0, 10)}`;

const supportRejection = (record: JsonObject): Rejection | undefined => {
  const by = record["by"];
  if (by !== "machine" && by !== "person") return "not_a_decider";
  const state = record["state"];
  if (state === "machine-verified" && (by !== "machine" || typeof record["ref"] !== "string")) return "wrong_decider";
  if (state === "person-judged" && by !== "person") return "wrong_decider";
  if (state === "handed-off" && typeof record["to"] !== "string") return "no_handoff_target";
  return undefined;
};

export const rejectionOf = (record: JsonObject): Rejection | undefined => {
  if (record["type"] === "band" || "band" in record) return "band_derived";
  const type = oneOf(ENTRY_TYPES, record["type"]);
  if (type === undefined) return "unknown_type";
  if (type === "evidence" && record["proof"] !== "exposure" && typeof record["ref"] !== "string") return "no_pointer";
  if (type === "support") return supportRejection(record);
  return undefined;
};

export const appendEntry = (
  runtime: Pick<Runtime, "appendText" | "mkdir">,
  paths: FmPaths,
  record: JsonObject,
): Appended => {
  const rejected = rejectionOf(record);
  if (rejected !== undefined) return { ok: false, reason: rejected };
  const entry = parseEntry(record);
  if (entry === undefined) return { ok: false, reason: "invalid" };
  runtime.mkdir(paths.dir);
  const written = runtime.appendText(judgePath(paths), `${JSON.stringify({ schema: JUDGE_SCHEMA, ...entry })}\n`);
  return written.ok ? { ok: true, entry } : { ok: false, reason: "write_failed" };
};

export const parseLog = (content: string): readonly JudgeEntry[] =>
  content.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    const entry = parsed?.ok === true && isRecord(parsed.value) ? parseEntry(parsed.value) : undefined;
    return entry === undefined ? [] : [entry];
  });

export const readEntries = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly JudgeEntry[] => {
  const content = runtime.readText(judgePath(paths));
  return content.ok ? parseLog(content.value) : [];
};

const only = <T extends JudgeEntry["type"]>(
  entries: readonly JudgeEntry[],
  type: T,
): readonly Extract<JudgeEntry, { readonly type: T }>[] =>
  entries.filter((entry): entry is Extract<JudgeEntry, { readonly type: T }> => entry.type === type);

export const exportOf = (entries: readonly JudgeEntry[]): JudgeExport => ({
  schema: JUDGE_SCHEMA,
  domains: only(entries, "domain"),
  concepts: only(entries, "concept"),
  evidence: only(entries, "evidence"),
  contests: only(entries, "contest"),
  claims: only(entries, "claim"),
  support: only(entries, "support"),
  results: only(entries, "result"),
  horizon: only(entries, "horizon"),
  signals: only(entries, "signal"),
  events: only(entries, "event"),
  items: only(entries, "item"),
  asks: only(entries, "ask"),
});

export const exportJudge = (runtime: Pick<Runtime, "readText">, paths: FmPaths): JudgeExport =>
  exportOf(readEntries(runtime, paths));

const mentions = (entry: JudgeEntry, id: string): boolean => {
  if (entry.id === id) return true;
  if (entry.type === "contest") return entry.target === id;
  if (entry.type === "support" || entry.type === "event") return entry.claim === id;
  if (entry.type === "evidence") return entry.claim === id;
  return false;
};

export const forgetJudge = (
  runtime: Pick<Runtime, "readText" | "writeAtomic" | "remove">,
  paths: FmPaths,
  id: string | undefined,
): number => {
  const entries = readEntries(runtime, paths);
  if (id === undefined) {
    runtime.remove(judgePath(paths));
    runtime.remove(judgeDir(paths));
    return entries.length;
  }
  const kept = entries.filter((entry) => !mentions(entry, id));
  runtime.writeAtomic(
    judgePath(paths),
    kept.map((entry) => `${JSON.stringify({ schema: JUDGE_SCHEMA, ...entry })}\n`).join(""),
  );
  return entries.length - kept.length;
};
