import { isRecord, type JsonObject } from "../core/parsed.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { BLUEPRINT_TYPES, parseBlueprintType } from "../planta/types.js";
import { parseShortcuts } from "./shortcuts.js";
import {
  type AcceptanceCheck,
  CHECK_KINDS,
  type CheckKind,
  type DiffBudget,
  GIT_REQUIREMENTS,
  type GitRequirement,
  SIZES,
  TASK_ID,
  type TaskContract,
  type TaskScope,
  type TaskSize,
} from "./types.js";

type Issues = string[];

const str = (record: JsonObject, key: string, at: string, issues: Issues, required: boolean): string | undefined => {
  const value = record[key];
  if (value === undefined || value === null) {
    if (required) issues.push(`${at}${key}: required`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${at}${key}: must be non-empty text`);
    return undefined;
  }
  return value;
};

const positive = (record: JsonObject, key: string, at: string, issues: Issues): number | undefined => {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  issues.push(`${at}${key}: must be a positive integer`);
  return undefined;
};

const strings = (value: unknown, at: string, issues: Issues): readonly string[] => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  issues.push(`${at}: must be a list of text`);
  return [];
};

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find((option) => option === value);

const gitRequire = (value: unknown, at: string, issues: Issues): readonly GitRequirement[] => {
  const items = strings(value, at, issues);
  const known = items.map((item) => oneOf(GIT_REQUIREMENTS, item));
  if (known.some((item) => item === undefined)) issues.push(`${at}: use ${GIT_REQUIREMENTS.join(", ")}`);
  return known.filter((item): item is GitRequirement => item !== undefined);
};

const appFields = (record: JsonObject, kind: CheckKind, at: string, issues: Issues): Partial<AcceptanceCheck> => {
  const port = positive(record, "port", at, issues);
  if (kind === "runtime" && port === undefined) issues.push(`${at}port: required`);
  if (port !== undefined && port > 65535) issues.push(`${at}port: must be at most 65535`);
  const status = positive(record, "status", at, issues);
  const route = str(record, "route", at, issues, false);
  const body = str(record, "body", at, issues, false);
  return {
    ...(port === undefined ? {} : { port }),
    ...(route === undefined ? {} : { route }),
    ...(status === undefined ? {} : { status }),
    ...(body === undefined ? {} : { body }),
  };
};

const nonNegative = (record: JsonObject, key: string, at: string, issues: Issues): number | undefined => {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  issues.push(`${at}${key}: must be a number of zero or more`);
  return undefined;
};

const extraFields = (record: JsonObject, kind: CheckKind, at: string, issues: Issues): Partial<AcceptanceCheck> => {
  const cases = str(record, "cases", at, issues, kind === "golden");
  const tolerance = nonNegative(record, "tolerance", at, issues);
  const run = record["run"];
  if (kind === "golden" && typeof run === "string" && !run.includes("{case}")) {
    issues.push(`${at}run: must contain {case}`);
  }
  const minScore = positive(record, "min_score", at, issues);
  if (minScore !== undefined && minScore > 100) issues.push(`${at}min_score: must be at most 100`);
  return {
    ...(cases === undefined ? {} : { cases }),
    ...(tolerance === undefined ? {} : { tolerance }),
    ...(minScore === undefined ? {} : { minScore }),
  };
};

const checkFields = (record: JsonObject, kind: CheckKind, at: string, issues: Issues): Partial<AcceptanceCheck> => {
  const run = str(record, "run", at, issues, kind === "command" || kind === "golden");
  const timeoutS = positive(record, "timeout_s", at, issues);
  const description = str(record, "description", at, issues, kind === "manual");
  const require = kind === "git" ? gitRequire(record["require"] ?? ["committed"], `${at}require`, issues) : undefined;
  const app = appFields(record, kind, at, issues);
  const versionUrl = str(record, "version_url", at, issues, false);
  const field = str(record, "field", at, issues, false);
  const open = record["require_open"];
  if (open !== undefined && typeof open !== "boolean") issues.push(`${at}require_open: must be true or false`);
  return {
    ...(run === undefined ? {} : { run }),
    ...(timeoutS === undefined ? {} : { timeoutS }),
    ...(description === undefined ? {} : { description }),
    ...(require === undefined ? {} : { require }),
    ...(typeof open === "boolean" ? { requireOpen: open } : {}),
    ...app,
    ...(versionUrl === undefined ? {} : { versionUrl }),
    ...(field === undefined ? {} : { field }),
    ...extraFields(record, kind, at, issues),
  };
};

const acceptanceItem = (value: unknown, index: number, issues: Issues): AcceptanceCheck | undefined => {
  const at = `acceptance[${String(index)}].`;
  if (!isRecord(value)) {
    issues.push(`${at.slice(0, -1)}: must be a mapping`);
    return undefined;
  }
  const id = str(value, "id", at, issues, true);
  const kind = oneOf(CHECK_KINDS, value["check"]);
  if (kind === undefined) issues.push(`${at}check: use one of ${CHECK_KINDS.join(", ")}`);
  if (id === undefined || kind === undefined) return undefined;
  return { id, kind, ...checkFields(value, kind, at, issues) };
};

const acceptance = (value: unknown, issues: Issues): readonly AcceptanceCheck[] => {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push("acceptance: must list at least one check");
    return [];
  }
  const items = value.map((item, index) => acceptanceItem(item, index, issues));
  const checks = items.filter((item): item is AcceptanceCheck => item !== undefined);
  const ids = checks.map((check) => check.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) issues.push(`acceptance: duplicate id "${duplicate}"`);
  return checks;
};

const scope = (value: unknown, issues: Issues): TaskScope => {
  if (value === undefined || value === null) return { paths: [], testsProtected: true };
  if (!isRecord(value)) {
    issues.push("scope: must be a mapping");
    return { paths: [], testsProtected: true };
  }
  const budget = value["diff_budget"];
  const diffBudget: DiffBudget | undefined = isRecord(budget)
    ? (({ files, lines }) => ({
        ...(files === undefined ? {} : { files }),
        ...(lines === undefined ? {} : { lines }),
      }))({
        files: positive(budget, "files", "scope.diff_budget.", issues),
        lines: positive(budget, "lines", "scope.diff_budget.", issues),
      })
    : undefined;
  if (budget !== undefined && budget !== null && !isRecord(budget)) issues.push("scope.diff_budget: must be a mapping");
  const protectedValue = value["tests_protected"];
  if (protectedValue !== undefined && typeof protectedValue !== "boolean") {
    issues.push("scope.tests_protected: must be true or false");
  }
  return {
    paths: strings(value["paths"], "scope.paths", issues),
    ...(diffBudget === undefined ? {} : { diffBudget }),
    testsProtected: protectedValue !== false,
  };
};

export const validateContract = (value: unknown, implicit = false): Parsed<TaskContract, readonly string[]> => {
  if (!isRecord(value)) return reject(["the contract must be a YAML mapping"]);
  const issues: Issues = [];
  const id = str(value, "id", "", issues, true);
  if (id !== undefined && !TASK_ID.test(id)) issues.push("id: use letters, digits, dot, dash or underscore (max 64)");
  const goal = str(value, "goal", "", issues, true);
  const size: TaskSize | undefined = value["size"] === undefined ? "S" : oneOf(SIZES, value["size"]);
  if (size === undefined) issues.push(`size: use ${SIZES.join(", ")}`);
  const base = str(value, "base", "", issues, false);
  const contractScope = scope(value["scope"], issues);
  const checks = acceptance(value["acceptance"], issues);
  const decisionsNeeded = strings(value["decisions_needed"], "decisions_needed", issues);
  const callersIgnore = strings(value["callers_ignore"], "callers_ignore", issues);
  const shortcuts = parseShortcuts(value["shortcuts"], checks, issues);
  const blueprint = parseBlueprintType(str(value, "blueprint", "", issues, false));
  const clarified = strings(value["clarified"], "clarified", issues);
  if (value["blueprint"] !== undefined && blueprint === undefined) {
    issues.push(`blueprint: use ${BLUEPRINT_TYPES.join(", ")}`);
  }
  if (issues.length > 0 || id === undefined || goal === undefined || size === undefined) return reject(issues);
  return accept({
    id,
    goal,
    size,
    ...(base === undefined ? {} : { base }),
    scope: contractScope,
    acceptance: checks,
    decisionsNeeded,
    ...(callersIgnore.length === 0 ? {} : { callersIgnore }),
    ...(shortcuts.length === 0 ? {} : { shortcuts }),
    ...(blueprint === undefined ? {} : { blueprint }),
    implicit,
    ...(clarified.length === 0 ? {} : { clarified }),
    ...(value["tests_first"] === true ? { testsFirst: true } : {}),
  });
};
