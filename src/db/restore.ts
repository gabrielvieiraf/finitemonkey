import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, type ConfigTree } from "../git/project-config.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { isLocalDatabase } from "./throwaway.js";

export const RESTORE_FEATURE = "restore-drill";
export const DEFAULT_PERIOD_DAYS = 30;
export const PROTECTIONS = ["object-lock", "deny-delete", "other-account"] as const;

export interface DataStore {
  readonly name: string;
  readonly backup: string;
  readonly backupAccount: string | undefined;
  readonly protection: string | undefined;
  readonly evidence: string | undefined;
  readonly restore: string | undefined;
  readonly target: string | undefined;
  readonly counts: string | undefined;
  readonly expect: readonly string[];
}

export interface RestoreConfig {
  readonly appAccount: string | undefined;
  readonly appBuckets: readonly string[];
  readonly periodDays: number;
  readonly stores: readonly DataStore[];
}

const text = (tree: ConfigTree, ...path: readonly string[]): string | undefined => {
  const value = configAt(tree, ...path);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

export const restoreConfig = (config: ConfigTree): RestoreConfig => {
  const stores = configAt(config, "restore", "stores");
  const period = Number.parseInt(text(config, "restore", "period_days") ?? "", 10);
  return {
    appAccount: text(config, "restore", "app_account"),
    appBuckets: configList(config, "restore", "app_buckets"),
    periodDays: Number.isFinite(period) && period > 0 ? period : DEFAULT_PERIOD_DAYS,
    stores:
      stores === undefined || typeof stores === "string" || Array.isArray(stores)
        ? []
        : Object.keys(stores).map((name) => {
            const field = (key: string): string | undefined => text(config, "restore", "stores", name, key);
            return {
              name,
              backup: field("backup") ?? "",
              backupAccount: field("backup_account"),
              protection: field("protection"),
              evidence: field("evidence"),
              restore: field("restore"),
              target: field("target"),
              counts: field("counts"),
              expect: configList(config, "restore", "stores", name, "expect"),
            };
          }),
  };
};

export type ReachProblem = "no-backup" | "same-bucket" | "same-account" | "evidence-missing";

export interface ReachFinding {
  readonly store: string;
  readonly problem: ReachProblem;
  readonly evidenceSha256?: string;
}

export const bucketOf = (location: string): string | undefined =>
  /^(?:s3|gs|az|r2|b2|spaces):\/\/([^/]+)/i.exec(location)?.[1]?.toLowerCase();

const isProtected = (store: DataStore): boolean =>
  store.protection !== undefined && (PROTECTIONS as readonly string[]).includes(store.protection);

export const reachFindings = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  config: RestoreConfig,
): readonly ReachFinding[] =>
  config.stores.flatMap((store): ReachFinding[] => {
    if (store.evidence !== undefined) {
      const read = runtime.readText(toAbsolutePath(join(root, store.evidence)));
      return read.ok ? [] : [{ store: store.name, problem: "evidence-missing" }];
    }
    if (store.backup === "") return [{ store: store.name, problem: "no-backup" }];
    const bucket = bucketOf(store.backup);
    const buckets = config.appBuckets.map((item) => item.toLowerCase());
    if (bucket !== undefined && buckets.includes(bucket) && !isProtected(store)) {
      return [{ store: store.name, problem: "same-bucket" }];
    }
    const sameAccount = store.backupAccount === undefined || store.backupAccount === config.appAccount;
    return sameAccount && !isProtected(store) ? [{ store: store.name, problem: "same-account" }] : [];
  });

export const evidenceHash = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  file: string,
): string | undefined => {
  const read = runtime.readText(toAbsolutePath(join(root, file)));
  return read.ok ? sha256Hex(read.value) : undefined;
};

export type DrillStatus = "passed" | "failed" | "refused" | "not_configured";

export interface DrillResult {
  readonly store: string;
  readonly status: DrillStatus;
  readonly source: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly detail: string;
}

const DRILL_TIMEOUT_MS = 30 * 60_000;
const DETAIL_LIMIT = 300;

export const parseCounts = (stdout: string): Readonly<Record<string, number>> => {
  const json = parseJsonObject(stdout.trim());
  if (json.ok) {
    return Object.fromEntries(
      Object.entries(json.value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
  }
  return Object.fromEntries(
    stdout.split("\n").flatMap((line): [string, number][] => {
      const match = /^\s*([\w.-]+)\s*[:\s]\s*(\d+)\s*$/.exec(line);
      return match?.[1] === undefined || match[2] === undefined ? [] : [[match[1], Number(match[2])]];
    }),
  );
};

export const runDrill = (runtime: Runtime, root: AbsolutePath, store: DataStore): DrillResult => {
  const result = (status: DrillStatus, detail = "", counts: Readonly<Record<string, number>> = {}): DrillResult => ({
    store: store.name,
    status,
    source: store.backup,
    counts,
    detail,
  });
  if (store.restore === undefined || store.target === undefined) return result("not_configured");
  if (!isLocalDatabase(store.target)) return result("refused", store.target.replace(/\/\/[^@/]*@/, "//***@"));
  const exec = (command: string) =>
    runtime.exec({
      command,
      args: [],
      cwd: root,
      shell: true,
      timeoutMs: DRILL_TIMEOUT_MS,
      env: { RESTORE_TARGET: store.target ?? "", RESTORE_SOURCE: store.backup, FINITEMONKEY_THROWAWAY: "1" },
    });
  const started = nowMs(runtime);
  const restored = exec(store.restore);
  if (!restored.found || restored.exitCode !== 0 || restored.timedOut) {
    return result("failed", (restored.stderr || restored.stdout).trim().slice(-DETAIL_LIMIT));
  }
  if (store.counts === undefined) return result("passed", `${String(nowMs(runtime) - started)} ms`);
  const counted = exec(store.counts);
  const counts = counted.exitCode === 0 ? parseCounts(counted.stdout) : {};
  const empty = store.expect.filter((table) => (counts[table] ?? 0) === 0);
  if (counted.exitCode !== 0 || empty.length > 0) {
    return result("failed", empty.length > 0 ? `empty: ${empty.join(", ")}` : counted.stderr.trim(), counts);
  }
  return result("passed", `${String(nowMs(runtime) - started)} ms`, counts);
};

export const isStale = (lastPassed: string | undefined, now: number, periodDays: number): boolean =>
  lastPassed === undefined || now - Date.parse(lastPassed) > periodDays * 86_400_000;
