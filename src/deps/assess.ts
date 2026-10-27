import type { Ecosystem, RequestedPackage } from "./install-command.js";
import { closePopular } from "./popular.js";
import type { Lookup } from "./registry.js";

export const MIN_HISTORY_DAYS = 30;
export const MIN_VERSION_AGE_DAYS = 3;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type DepsFinding =
  | { readonly kind: "missing"; readonly name: string; readonly ecosystem: Ecosystem }
  | { readonly kind: "typo"; readonly name: string; readonly popular: string }
  | { readonly kind: "young"; readonly name: string; readonly days: number; readonly count: number }
  | { readonly kind: "fresh"; readonly name: string; readonly version: string; readonly hours: number }
  | { readonly kind: "script"; readonly name: string; readonly version: string }
  | { readonly kind: "unchecked"; readonly name: string; readonly ecosystem: Ecosystem };

const registryFindings = (pkg: RequestedPackage, lookup: Lookup, nowMs: number): readonly DepsFinding[] => {
  if (lookup.kind === "missing") return [{ kind: "missing", name: pkg.name, ecosystem: pkg.ecosystem }];
  if (lookup.kind === "unreachable") return [{ kind: "unchecked", name: pkg.name, ecosystem: pkg.ecosystem }];
  const { facts } = lookup;
  const out: DepsFinding[] = [];
  if (facts.createdMs !== undefined && nowMs - facts.createdMs < MIN_HISTORY_DAYS * DAY_MS) {
    const days = Math.max(0, Math.floor((nowMs - facts.createdMs) / DAY_MS));
    out.push({ kind: "young", name: pkg.name, days, count: facts.versionCount });
  }
  const { version, versionMs } = facts;
  if (version !== undefined && versionMs !== undefined && nowMs - versionMs < MIN_VERSION_AGE_DAYS * DAY_MS) {
    out.push({ kind: "fresh", name: pkg.name, version, hours: Math.max(0, Math.floor((nowMs - versionMs) / HOUR_MS)) });
  }
  if (version !== undefined && facts.installScript && !facts.previousInstallScript) {
    out.push({ kind: "script", name: pkg.name, version });
  }
  return out;
};

export const assessPackage = (pkg: RequestedPackage, lookup: Lookup, nowMs: number): readonly DepsFinding[] => {
  const popular = closePopular(pkg.ecosystem, pkg.name);
  const typo: readonly DepsFinding[] = popular === undefined ? [] : [{ kind: "typo", name: pkg.name, popular }];
  return [...typo, ...registryFindings(pkg, lookup, nowMs)];
};
