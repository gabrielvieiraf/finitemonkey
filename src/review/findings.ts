import { isRecord, type JsonObject } from "../core/parsed.js";

export const GROUPS = ["must", "should", "nice"] as const;
export type Group = (typeof GROUPS)[number];

export const VERDICTS = ["approve", "approve-with-changes", "request-changes"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Repro {
  readonly command: string;
  readonly expect: string;
}

export interface Finding {
  readonly id: number;
  readonly group: Group;
  readonly what: string;
  readonly problem: string;
  readonly fix: string;
  readonly ifNotFixed: string;
  readonly repro?: Repro;
  readonly activeRisk: boolean;
  readonly demoted: boolean;
}

export interface Critique {
  readonly verdict: Verdict;
  readonly findings: readonly Finding[];
}

const text = (record: JsonObject, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

const reproOf = (value: unknown): Repro | undefined => {
  if (!isRecord(value)) return undefined;
  const command = text(value, "command");
  const expect = text(value, "expect");
  return command === "" || expect === "" ? undefined : { command, expect };
};

const findingOf = (value: unknown, index: number): Finding | string => {
  if (!isRecord(value)) return `finding ${String(index + 1)} is not an object`;
  const group = GROUPS.find((item) => item === value["group"]);
  if (group === undefined) return `finding ${String(index + 1)} needs group must, should or nice`;
  const fields = ["what", "problem", "fix", "ifNotFixed"] as const;
  const missing = fields.filter((key) => text(value, key) === "");
  if (missing.length > 0) return `finding ${String(index + 1)} is missing ${missing.join(", ")}`;
  const repro = reproOf(value["repro"]);
  const demoted = group === "must" && repro === undefined;
  return {
    id: index + 1,
    group: demoted ? "should" : group,
    what: text(value, "what"),
    problem: text(value, "problem"),
    fix: text(value, "fix"),
    ifNotFixed: text(value, "ifNotFixed"),
    ...(repro === undefined ? {} : { repro }),
    activeRisk: value["activeRisk"] === true,
    demoted,
  };
};

export const parseCritique = (value: unknown): Critique | readonly string[] => {
  if (!isRecord(value)) return ["the critique must be a JSON object"];
  const verdict = VERDICTS.find((item) => item === value["verdict"]);
  const list = value["findings"];
  const parsed = Array.isArray(list) ? list.map(findingOf) : ["findings must be a list"];
  const errors = [
    ...(verdict === undefined ? [`verdict must be one of ${VERDICTS.join(", ")}`] : []),
    ...parsed.filter((item): item is string => typeof item === "string"),
  ];
  if (errors.length > 0 || verdict === undefined) return errors;
  return { verdict, findings: parsed.filter((item): item is Finding => typeof item !== "string") };
};
