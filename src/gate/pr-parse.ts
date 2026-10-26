import { isRecord, type JsonObject, optionalString, parseJsonObject } from "../core/parsed.js";

export type CiState = "passed" | "failed" | "pending";

export interface CiCheck {
  readonly name: string;
  readonly state: CiState;
}

export interface PrInfo {
  readonly number: number;
  readonly url: string;
  readonly state: string;
  readonly mergeable: string;
  readonly mergeStateStatus: string;
  readonly baseRefName: string;
  readonly headRefOid: string;
  readonly checks: readonly CiCheck[];
}

const FAILED = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const PENDING = new Set(["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"]);

const ciState = (item: JsonObject): CiState => {
  const conclusion = (optionalString(item, "conclusion") ?? "").toUpperCase();
  const status = (optionalString(item, "status") ?? optionalString(item, "state") ?? "").toUpperCase();
  if (FAILED.has(conclusion) || FAILED.has(status)) return "failed";
  if (conclusion === "" && (PENDING.has(status) || status === "")) return "pending";
  if (PENDING.has(status)) return "pending";
  return "passed";
};

const ciChecks = (value: unknown): readonly CiCheck[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        if (!isRecord(item)) return [];
        const name = optionalString(item, "name") ?? optionalString(item, "context") ?? "?";
        return [{ name, state: ciState(item) }];
      })
    : [];

export const parsePrView = (text: string): PrInfo | undefined => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return undefined;
  const record = parsed.value;
  const number = record["number"];
  if (typeof number !== "number") return undefined;
  return {
    number,
    url: optionalString(record, "url") ?? "",
    state: optionalString(record, "state") ?? "",
    mergeable: optionalString(record, "mergeable") ?? "UNKNOWN",
    mergeStateStatus: optionalString(record, "mergeStateStatus") ?? "UNKNOWN",
    baseRefName: optionalString(record, "baseRefName") ?? "",
    headRefOid: optionalString(record, "headRefOid") ?? "",
    checks: ciChecks(record["statusCheckRollup"]),
  };
};

export const isConflicting = (pr: PrInfo): boolean => pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";

export const parseMergeTreeConflicts = (stdout: string): readonly string[] => {
  const [, ...rest] = stdout.split("\n");
  const end = rest.indexOf("");
  return [...new Set((end < 0 ? rest : rest.slice(0, end)).map((line) => line.trim()).filter((line) => line !== ""))];
};
