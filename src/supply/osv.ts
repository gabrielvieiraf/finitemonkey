import type { AbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { ExecRequest, ExecResult } from "../core/runtime.js";

export const OSV_COMMAND = "osv-scanner";
export const OSV_TIMEOUT_MS = 300_000;

export const SEVERITIES = ["critical", "high", "medium", "low", "unknown"] as const;

export type VulnSeverity = (typeof SEVERITIES)[number];

export interface Vulnerability {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly ecosystem: string;
  readonly name: string;
  readonly version: string;
  readonly severity: VulnSeverity;
  readonly fixed: string | undefined;
  readonly source: string;
}

export const osvRequest = (root: AbsolutePath): ExecRequest => ({
  command: OSV_COMMAND,
  args: ["--format", "json", "--recursive", "."],
  cwd: root,
  timeoutMs: OSV_TIMEOUT_MS,
});

const list = (value: unknown, key: string): readonly unknown[] => {
  const inner = isRecord(value) ? value[key] : undefined;
  return Array.isArray(inner) ? inner : [];
};

const text = (value: unknown, key: string): string => {
  const inner = isRecord(value) ? value[key] : undefined;
  return typeof inner === "string" ? inner : "";
};

const strings = (value: unknown, key: string): readonly string[] =>
  list(value, key).filter((item): item is string => typeof item === "string");

const fromScore = (score: number): VulnSeverity => {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return score > 0 ? "low" : "unknown";
};

const fromLabel = (label: string): VulnSeverity => {
  const lower = label.toLowerCase();
  if (lower === "moderate") return "medium";
  return SEVERITIES.find((severity) => severity === lower) ?? "unknown";
};

const severityOf = (group: unknown, vulns: readonly unknown[]): VulnSeverity => {
  const score = Number.parseFloat(text(group, "max_severity"));
  if (Number.isFinite(score)) return fromScore(score);
  const labels = vulns.map((vuln) => {
    const specific = isRecord(vuln) ? vuln["database_specific"] : undefined;
    return fromLabel(text(specific, "severity"));
  });
  return SEVERITIES.find((severity) => labels.includes(severity)) ?? "unknown";
};

const fixedVersion = (vulns: readonly unknown[], name: string): string | undefined =>
  vulns
    .flatMap((vuln) => list(vuln, "affected"))
    .filter((affected) => {
      const pkg = isRecord(affected) ? affected["package"] : undefined;
      return text(pkg, "name") === "" || text(pkg, "name") === name;
    })
    .flatMap((affected) => list(affected, "ranges"))
    .flatMap((range) => list(range, "events"))
    .map((event) => text(event, "fixed"))
    .find((fixed) => fixed !== "");

const packageVulns = (source: string, entry: unknown): readonly Vulnerability[] => {
  const pkg = isRecord(entry) ? entry["package"] : undefined;
  const name = text(pkg, "name");
  const vulns = list(entry, "vulnerabilities");
  const groups = list(entry, "groups");
  const units: readonly unknown[] = groups.length > 0 ? groups : vulns.map((vuln) => ({ ids: [text(vuln, "id")] }));
  return units.map((group) => {
    const ids = strings(group, "ids");
    const members = vulns.filter((vuln) => ids.includes(text(vuln, "id")));
    return {
      id: [...ids].sort()[0] ?? "",
      aliases: ids,
      ecosystem: text(pkg, "ecosystem"),
      name,
      version: text(pkg, "version"),
      severity: severityOf(group, members),
      fixed: fixedVersion(members, name),
      source,
    };
  });
};

export const parseOsv = (doc: JsonObject): readonly Vulnerability[] =>
  list(doc, "results").flatMap((result) => {
    const source = text(isRecord(result) ? result["source"] : undefined, "path");
    return list(result, "packages").flatMap((entry) => packageVulns(source, entry));
  });

export type OsvRun =
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly detail: string }
  | { readonly kind: "done"; readonly vulns: readonly Vulnerability[] };

export const osvOutcome = (result: ExecResult): OsvRun => {
  if (!result.found) return { kind: "missing" };
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return { kind: "failed", detail: result.stderr.trim().split("\n").at(-1) ?? "" };
  }
  if (result.stdout.trim() === "") return { kind: "done", vulns: [] };
  const doc = parseJsonObject(result.stdout);
  return doc.ok ? { kind: "done", vulns: parseOsv(doc.value) } : { kind: "failed", detail: doc.error };
};
