import { basename } from "node:path";

import { isRecord, parseJsonObject } from "../core/parsed.js";
import { claimsIn } from "./claims.js";
import { rowOf, type XrayRow } from "./response.js";
import { needsTriage, triageRows } from "./triage.js";
import type { JudgeEntry, ResultEntry } from "./types.js";

export const TRIAGE_TRIGGERS = ["document", "decision", "commit", "research"] as const;

export type TriageTrigger = (typeof TRIAGE_TRIGGERS)[number];

const resultsIn = (entries: readonly JudgeEntry[]): readonly ResultEntry[] =>
  entries.filter((entry): entry is ResultEntry => entry.type === "result");

export const claimRows = (entries: readonly JudgeEntry[], ids: readonly string[]): readonly XrayRow[] =>
  [...new Set(ids)].flatMap((id) => {
    const row = rowOf(id, entries);
    return row !== undefined && needsTriage(row) ? [row] : [];
  });

const mentioned = (entries: readonly JudgeEntry[], text: string): readonly string[] =>
  claimsIn(entries).flatMap((claim) => (new RegExp(`(?<![\\w-])${claim.id}(?![\\w-])`).test(text) ? [claim.id] : []));

const textList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const decisionRows = (entries: readonly JudgeEntry[], text: string): readonly XrayRow[] => {
  const parsed = parseJsonObject(text);
  const record = parsed.ok && isRecord(parsed.value) ? parsed.value : {};
  const task = typeof record["task"] === "string" ? record["task"] : undefined;
  const research = textList(record["research"]);
  const linked = resultsIn(entries).flatMap((result) =>
    (task !== undefined && result.decision === task) ||
    (result.research !== undefined && research.includes(result.research))
      ? result.claims
      : [],
  );
  const rows = claimRows(entries, [...mentioned(entries, text), ...linked]);
  const cited = triageRows(entries, text).filter((row) => !rows.some((item) => item.claim === row.claim));
  return [...rows, ...cited];
};

const refersTo = (message: string, source: string): boolean => {
  if (message.includes(source)) return true;
  const name = basename(source);
  return name.includes(".") && name !== source && /^[^/\\]+$/.test(name) && message.includes(name);
};

export const commitRows = (entries: readonly JudgeEntry[], message: string): readonly XrayRow[] =>
  claimRows(
    entries,
    resultsIn(entries).flatMap((result) => (refersTo(message, result.source) ? result.claims : [])),
  );

export const researchRows = (
  entries: readonly JudgeEntry[],
  slug: string,
  sourceClaims: readonly string[],
): readonly XrayRow[] =>
  claimRows(entries, [
    ...sourceClaims,
    ...resultsIn(entries).flatMap((result) => (result.research === slug ? result.claims : [])),
  ]);
