import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { isRecord, parseJsonObject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { type Finding, stableFindingId } from "../../findings/baseline.js";
import { GITHUB_CACHE } from "../../github/ruleset.js";
import { sha256Hex } from "../../secrets/fingerprint.js";
import { type ProjectLevel, projectLevel } from "../level.js";
import { readSettingsCache } from "../protect/state.js";
import { type AuditHit, auditWorkflow, type Severity } from "./rules.js";
import { runTools } from "./tools.js";
import { parseWorkflow } from "./workflow.js";

export const CI_AUDIT_CHECK = "ci-audit";
export const WORKFLOWS_DIR = ".github/workflows";

export interface AuditFinding extends Finding {
  readonly severity: Severity;
  readonly detail: string;
}

export interface AuditReport {
  readonly level: ProjectLevel;
  readonly files: readonly string[];
  readonly findings: readonly AuditFinding[];
  readonly missingTools: readonly string[];
}

export type AuditRuntime = Pick<Runtime, "readText" | "listDir" | "exec" | "homeDir">;

export const workflowFiles = (runtime: Pick<Runtime, "listDir">, root: AbsolutePath): readonly string[] => {
  const listed = runtime.listDir(toAbsolutePath(join(root, ...WORKFLOWS_DIR.split("/"))));
  return listed.ok
    ? listed.value
        .filter((name) => /\.ya?ml$/.test(name))
        .sort()
        .map((name) => `${WORKFLOWS_DIR}/${name}`)
    : [];
};

const publicRepo = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): boolean => {
  if (readSettingsCache(runtime, root)?.visibility === "public") return true;
  const text = runtime.readText(toAbsolutePath(join(root, ...GITHUB_CACHE.split("/"))));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return parsed?.ok === true && isRecord(parsed.value) && parsed.value["visibility"] === "public";
};

const lineOf = (text: string, hit: AuditHit): number => {
  const lines = text.split("\n");
  const jobLine = hit.job === "" ? 0 : lines.findIndex((line) => line.trim() === `${hit.job}:`);
  const from = Math.max(0, jobLine);
  const found = lines.findIndex((line, index) => index >= from && hit.needle !== "" && line.includes(hit.needle));
  return (found >= 0 ? found : from) + 1;
};

const findingOf = (
  file: string,
  rule: string,
  line: number,
  severity: Severity,
  detail: string,
  key: string,
): AuditFinding => {
  const fingerprint = sha256Hex(`${rule}\u0000${key}`).slice(0, 16);
  return {
    id: stableFindingId(CI_AUDIT_CHECK, rule, file, fingerprint),
    check: CI_AUDIT_CHECK,
    rule,
    file,
    line,
    fingerprint,
    severity,
    detail,
  };
};

const parseFailure = (file: string, error: string): AuditFinding =>
  findingOf(file, "unreadable-workflow", 1, "block", error, error);

export const auditText = (
  file: string,
  text: string,
  level: ProjectLevel,
  isPublic: boolean,
): readonly AuditFinding[] => {
  const workflow = parseWorkflow(file, text);
  if (!workflow.ok) return [parseFailure(file, workflow.error)];
  return auditWorkflow(workflow.value, { level, publicRepo: isPublic }).map((hit) =>
    findingOf(file, hit.rule, lineOf(text, hit), hit.severity, hit.detail, `${hit.job}\u0000${hit.needle}`),
  );
};

export const auditRepo = (runtime: AuditRuntime, root: AbsolutePath, withTools = true): AuditReport => {
  const files = workflowFiles(runtime, root);
  const level = projectLevel(runtime, root);
  const isPublic = publicRepo(runtime, root);
  const native = files.flatMap((file) => {
    const text = runtime.readText(toAbsolutePath(join(root, ...file.split("/"))));
    return text.ok ? auditText(file, text.value, level, isPublic) : [parseFailure(file, text.error)];
  });
  const tools = withTools ? runTools(runtime, root, files) : { hits: [], missing: [] };
  const external = tools.hits.map((hit) =>
    findingOf(hit.file, hit.rule, hit.line, hit.severity, hit.detail, hit.detail),
  );
  return { level, files, findings: [...native, ...external], missingTools: tools.missing };
};
