import type { DeployLevel, InfraPattern, Inventory } from "../infra/types.js";
import { LOG_PATH, PLAN_PATH, SCRUB_PATH } from "./templates.js";

export const OBSERVE_ITEMS = [
  "platform-logs",
  "external-monitor",
  "error-tracking",
  "scrubber",
  "json-logs",
  "health-route",
  "monitor-health-payment",
  "alerts-team",
  "releases-sourcemaps",
  "aggregator-retention",
  "synthetic-checks",
  "alerts-severity",
] as const;

export type ObserveItem = (typeof OBSERVE_ITEMS)[number];

export type ItemState = "exists" | "generated" | "person";

const TEAM: readonly ObserveItem[] = [
  "error-tracking",
  "scrubber",
  "json-logs",
  "health-route",
  "releases-sourcemaps",
  "aggregator-retention",
  "synthetic-checks",
  "alerts-severity",
];

const BY_LEVEL: Readonly<Record<DeployLevel, readonly ObserveItem[]>> = {
  0: ["platform-logs", "external-monitor"],
  1: ["error-tracking", "scrubber", "json-logs", "health-route", "monitor-health-payment", "alerts-team"],
  2: TEAM,
  3: TEAM,
};

const DETECTED: Partial<Record<ObserveItem, readonly InfraPattern[]>> = {
  "error-tracking": ["sentry", "apm", "opentelemetry"],
  "json-logs": ["json-logger"],
  "health-route": ["health-route"],
};

const GENERATED: Partial<Record<ObserveItem, string>> = {
  scrubber: SCRUB_PATH,
  "json-logs": LOG_PATH,
  "aggregator-retention": PLAN_PATH,
  "synthetic-checks": PLAN_PATH,
  "alerts-severity": PLAN_PATH,
};

export interface ObserveRow {
  readonly item: ObserveItem;
  readonly state: ItemState;
  readonly exists: boolean;
  readonly file?: string;
}

export const observeRows = (
  level: DeployLevel,
  inventory: Inventory,
  existing: (path: string) => boolean,
): readonly ObserveRow[] =>
  BY_LEVEL[level].map((item) => {
    const patterns = DETECTED[item] ?? [];
    const file = GENERATED[item];
    const healthy = item === "health-route" && inventory.targets.some((target) => target.health === "yes");
    const exists =
      healthy || inventory.hits.some((hit) => patterns.includes(hit.pattern)) || (file !== undefined && existing(file));
    const state: ItemState = file === undefined ? (exists ? "exists" : "person") : exists ? "exists" : "generated";
    return { item, state, exists, ...(file === undefined ? {} : { file }) };
  });

export const filesFor = (level: DeployLevel): readonly string[] =>
  level === 0 ? [] : level === 1 ? [SCRUB_PATH, LOG_PATH] : [SCRUB_PATH, LOG_PATH, PLAN_PATH];
