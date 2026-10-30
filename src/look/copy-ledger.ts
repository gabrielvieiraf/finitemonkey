import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { type CopyFinding, type CopyRule } from "./copy-rules.js";

export const COPY_STATE_FILE = "copy-rules.json";
export const DEFAULT_MIN_SHOWN = 10;

export interface RuleLedger {
  readonly shown: Readonly<Record<string, string>>;
  readonly accepted: readonly string[];
}

export type CopyLedger = Readonly<Record<CopyRule, RuleLedger>>;

const EMPTY: RuleLedger = { shown: {}, accepted: [] };

const byRule = (make: (rule: CopyRule) => RuleLedger): CopyLedger => ({
  "verb-first": make("verb-first"),
  "error-action": make("error-action"),
  "one-name": make("one-name"),
  "empty-label": make("empty-label"),
});

export const findingId = (finding: CopyFinding): string =>
  finding.rule === "one-name" ? finding.detail : `${finding.file}#${finding.key}`;

const ruleOf = (value: unknown): RuleLedger => {
  if (!isRecord(value)) return EMPTY;
  const shown = isRecord(value["shown"])
    ? Object.fromEntries(
        Object.entries(value["shown"]).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};
  const accepted = Array.isArray(value["accepted"])
    ? value["accepted"].filter((item): item is string => typeof item === "string")
    : [];
  return { shown, accepted };
};

export const readCopyLedger = (runtime: Pick<Runtime, "readText">, paths: FmPaths): CopyLedger => {
  const text = runtime.readText(paths.cache(COPY_STATE_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  const root = parsed?.ok === true ? parsed.value : {};
  return byRule((rule) => ruleOf(root[rule]));
};

export const writeCopyLedger = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, ledger: CopyLedger): void => {
  runtime.writeText(paths.cache(COPY_STATE_FILE), `${JSON.stringify(ledger, null, 2)}\n`);
};

export type CurrentText = (rule: CopyRule, id: string) => string | undefined;

export const updateLedger = (before: CopyLedger, findings: readonly CopyFinding[], current: CurrentText): CopyLedger =>
  byRule((rule) => {
    const old = before[rule];
    const now = findings.filter((finding) => finding.rule === rule);
    const flagged = new Set(now.map(findingId));
    const fixed = Object.entries(old.shown).flatMap(([id, text]) => {
      const present = current(rule, id);
      return flagged.has(id) || old.accepted.includes(id) || present === undefined || present === text ? [] : [id];
    });
    const shown = { ...old.shown, ...Object.fromEntries(now.map((finding) => [findingId(finding), finding.text])) };
    return { shown, accepted: [...old.accepted, ...fixed] };
  });

export interface RuleRate {
  readonly shown: number;
  readonly accepted: number;
}

export const rateOf = (ledger: RuleLedger): RuleRate => ({
  shown: Object.keys(ledger.shown).length,
  accepted: ledger.accepted.length,
});

export const ruleActive = (rate: RuleRate, threshold: number | undefined, minShown: number): boolean =>
  threshold !== undefined && rate.shown >= minShown && rate.accepted / rate.shown >= threshold;
