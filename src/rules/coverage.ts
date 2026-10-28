import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { asList, asRecord, parseSettings } from "../install/json-text.js";
import { SETTINGS_FILE } from "../install/layout.js";
import { type Manifest, readManifest, type Surface } from "./manifest.js";
import { AGENTS_MARKERS, workflowRuleIds } from "./outputs.js";
import { applicableSurfaces } from "./plan.js";
import type { ProjectRule, RuleSeverity } from "./types.js";

export const COVERAGE_STATUSES = ["full", "partial", "text only", "none"] as const;

export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export interface RuleCoverage {
  readonly id: string;
  readonly severity: RuleSeverity;
  readonly applicable: readonly Surface[];
  readonly surfaces: readonly Surface[];
  readonly status: CoverageStatus;
  readonly covered: boolean;
}

type CoverageRuntime = Pick<Runtime, "readText" | "listDir">;

const PROSE_FILES = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"] as const;

const read = (runtime: CoverageRuntime, root: AbsolutePath, file: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(file, root));
  return text.ok ? text.value : undefined;
};

const proseText = (runtime: CoverageRuntime, root: AbsolutePath): string => {
  const rules = runtime.listDir(toAbsolutePath(".claude/rules", root));
  const extra = rules.ok
    ? rules.value.filter((name) => name.endsWith(".md")).map((name) => `.claude/rules/${name}`)
    : [];
  return [...PROSE_FILES, ...extra]
    .map((file) => read(runtime, root, file) ?? "")
    .join("\n")
    .toLowerCase();
};

const configured = (settingsText: string | undefined, manifest: Manifest, id: string): boolean => {
  const compiled = manifest.rules[id];
  const parsed = parseSettings(settingsText);
  if (compiled === undefined || !parsed.ok) return false;
  const deny = asList(asRecord(parsed.value["permissions"])["deny"]).map(String);
  const keys = Object.entries(compiled.settings).every(
    ([key, value]) => JSON.stringify(parsed.value[key]) === JSON.stringify(value),
  );
  return compiled.deny.every((entry) => deny.includes(entry)) && keys;
};

const statusOf = (applicable: readonly Surface[], present: readonly Surface[]): CoverageStatus => {
  const enforced: readonly Surface[] = present.filter((surface) => surface !== "text");
  if (applicable.length > 0 && applicable.every((surface) => enforced.includes(surface))) return "full";
  if (enforced.length > 0) return "partial";
  return present.includes("text") ? "text only" : "none";
};

export const ruleCoverage = (
  runtime: CoverageRuntime,
  root: AbsolutePath,
  rules: readonly ProjectRule[],
): readonly RuleCoverage[] => {
  const manifest = readManifest(runtime, root);
  const settings = read(runtime, root, SETTINGS_FILE);
  const workflow = manifest.workflow === undefined ? undefined : read(runtime, root, manifest.workflow);
  const inWorkflow = workflow === undefined ? new Set<string>() : workflowRuleIds(workflow);
  const prose = proseText(runtime, root);
  const agents = read(runtime, root, "AGENTS.md") ?? "";
  const block = agents.includes(AGENTS_MARKERS.begin) ? agents.slice(agents.indexOf(AGENTS_MARKERS.begin)) : "";
  return rules.map((rule) => {
    const compiled = manifest.rules[rule.id]?.surfaces ?? [];
    const present: Surface[] = [];
    if (compiled.includes("guard")) present.push("guard");
    if (compiled.includes("config") && configured(settings, manifest, rule.id)) present.push("config");
    if (compiled.includes("git")) present.push("git");
    if (inWorkflow.has(rule.id)) present.push("ci");
    if (block.includes(`(rule ${rule.id})`) || prose.includes(rule.text.toLowerCase()) || prose.includes(rule.id))
      present.push("text");
    const applicable = applicableSurfaces(rule);
    const status = statusOf(applicable, present);
    return { id: rule.id, severity: rule.severity, applicable, surfaces: present, status, covered: status === "full" };
  });
};
