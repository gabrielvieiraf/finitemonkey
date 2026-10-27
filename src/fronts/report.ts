import { isRecord, type JsonObject, parseJson } from "../core/parsed.js";

export const FRONT_REPORT_SCHEMA = "finitemonkey/front-report@1";

export interface ReportTests {
  readonly command: string;
  readonly passed: number;
  readonly failed: number;
  readonly added: number;
}

export interface ReportScreenshot {
  readonly path: string;
  readonly viewport: number;
  readonly opened: boolean;
}

export interface LeftOut {
  readonly what: string;
  readonly why: string;
}

export interface ProvisionalDecision {
  readonly decision: string;
  readonly options: readonly string[];
  readonly recommendation: string;
  readonly needs_human: boolean;
}

export interface RoutedMessage {
  readonly at: string;
  readonly text: string;
  readonly done: string;
}

export interface FrontReport {
  readonly schema?: typeof FRONT_REPORT_SCHEMA;
  readonly front: string;
  readonly branch: string;
  readonly head: string;
  readonly commits: readonly string[];
  readonly delivered: readonly string[];
  readonly endpoints: readonly string[];
  readonly tests: ReportTests;
  readonly screenshots: readonly ReportScreenshot[];
  readonly left_out: readonly LeftOut[];
  readonly provisional_decisions: readonly ProvisionalDecision[];
  readonly evidence: string;
  readonly finished?: boolean;
  readonly inbox?: readonly RoutedMessage[];
}

type Issues = string[];

const text = (record: JsonObject, key: string, issues: Issues, allowEmpty = false): string => {
  const value = record[key];
  if (typeof value === "string" && (allowEmpty || value.trim() !== "")) return value;
  issues.push(`${key}: must be a${allowEmpty ? "" : " non-empty"} string`);
  return "";
};

const count = (record: JsonObject, key: string, issues: Issues): number => {
  const value = record[key];
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  issues.push(`tests.${key}: must be a whole number`);
  return 0;
};

const list = <T>(
  record: JsonObject,
  key: string,
  issues: Issues,
  item: (value: unknown, at: string) => T | undefined,
): readonly T[] => {
  const value = record[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(`${key}: must be a list`);
    return [];
  }
  return value.flatMap((entry: unknown, index) => {
    const parsed = item(entry, `${key}[${String(index)}]`);
    if (parsed === undefined) issues.push(`${key}[${String(index)}]: malformed`);
    return parsed === undefined ? [] : [parsed];
  });
};

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const screenshot = (value: unknown): ReportScreenshot | undefined => {
  if (!isRecord(value) || typeof value["path"] !== "string" || typeof value["viewport"] !== "number") return undefined;
  return { path: value["path"], viewport: value["viewport"], opened: value["opened"] === true };
};

const leftOut = (value: unknown): LeftOut | undefined =>
  isRecord(value) && typeof value["what"] === "string"
    ? { what: value["what"], why: str(value["why"]) ?? "" }
    : undefined;

const decision = (value: unknown): ProvisionalDecision | undefined => {
  if (!isRecord(value) || typeof value["decision"] !== "string") return undefined;
  const options = Array.isArray(value["options"])
    ? value["options"].filter((item): item is string => typeof item === "string")
    : [];
  return {
    decision: value["decision"],
    options,
    recommendation: str(value["recommendation"]) ?? "",
    needs_human: value["needs_human"] === true,
  };
};

const routed = (value: unknown): RoutedMessage | undefined =>
  isRecord(value) && typeof value["text"] === "string"
    ? { at: str(value["at"]) ?? "", text: value["text"], done: str(value["done"]) ?? "" }
    : undefined;

export const parseFrontReport = (
  raw: string,
): { readonly report: FrontReport | undefined; readonly issues: readonly string[] } => {
  const parsed = parseJson(raw);
  if (!parsed.ok || !isRecord(parsed.value)) return { report: undefined, issues: ["not a JSON object"] };
  const record = parsed.value;
  const issues: Issues = [];
  const tests = isRecord(record["tests"]) ? record["tests"] : {};
  if (!isRecord(record["tests"])) issues.push("tests: must be an object with command, passed, failed and added");
  const strings = (key: string): readonly string[] => list(record, key, issues, (value) => str(value));
  const report: FrontReport = {
    front: text(record, "front", issues),
    branch: text(record, "branch", issues),
    head: text(record, "head", issues),
    commits: strings("commits"),
    delivered: strings("delivered"),
    endpoints: strings("endpoints"),
    tests: {
      command: text(tests, "command", issues, true),
      passed: count(tests, "passed", issues),
      failed: count(tests, "failed", issues),
      added: count(tests, "added", issues),
    },
    screenshots: list(record, "screenshots", issues, screenshot),
    left_out: list(record, "left_out", issues, leftOut),
    provisional_decisions: list(record, "provisional_decisions", issues, decision),
    evidence: text(record, "evidence", issues, true),
    finished: record["finished"] !== false,
    inbox: list(record, "inbox", issues, routed),
  };
  if (report.finished === false && report.left_out.length === 0)
    issues.push("left_out: a NOT FINISHED report lists what is left out");
  return { report: issues.length === 0 ? report : undefined, issues };
};
