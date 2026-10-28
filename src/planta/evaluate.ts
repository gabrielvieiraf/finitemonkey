import { BLUEPRINTS, type ItemId } from "./blueprints.js";
import type { BlueprintItem, BlueprintType, Probe } from "./types.js";
import type { ProjectView } from "./view.js";

export const APPROVAL_TASK = "planta";

export type ItemStatus = "green" | "missing" | "manual";

export interface ItemResult {
  readonly id: ItemId;
  readonly area: string;
  readonly status: ItemStatus;
  readonly check: Probe["type"];
}

export interface BlueprintBar {
  readonly type: BlueprintType;
  readonly green: number;
  readonly total: number;
  readonly items: readonly ItemResult[];
  readonly next: ItemId | undefined;
  readonly tree: string | undefined;
}

const escape = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export const globRegex = (pattern: string): RegExp => {
  const directory = pattern.endsWith("/");
  const body = (directory ? pattern.slice(0, -1) : pattern)
    .split("**/")
    .map((part) => escape(part).replace(/\*/g, "[^/]*"))
    .join("(?:.*/)?");
  return new RegExp(`^${body}${directory ? "/" : "$"}`, "i");
};

const hasDependency = (manifests: string, name: string): boolean => {
  const quoted = new RegExp(`["']${escape(name)}["']`, "i");
  const line = new RegExp(`^\\s*${escape(name)}(?:\\s|[=<>~\\[;]|$)`, "im");
  return quoted.test(manifests) || line.test(manifests);
};

export const probeGreen = (probe: Probe, view: ProjectView): boolean => {
  switch (probe.type) {
    case "files":
      return probe.any.map(globRegex).some((pattern) => view.files.some((file) => pattern.test(file)));
    case "grep":
      return probe.all.every((pattern) => view.grep(pattern));
    case "deps":
      return (
        probe.any.some((name) => hasDependency(view.manifests, name)) ||
        (probe.orGrep !== undefined && view.grep(probe.orGrep))
      );
    case "contract":
      return view.passed(probe.kind);
    case "manual":
      return false;
  }
};

const statusOf = (item: BlueprintItem<ItemId>, view: ProjectView, approved: ReadonlySet<string>): ItemStatus => {
  if (item.probe.type === "manual") return approved.has(item.id) ? "green" : "manual";
  return probeGreen(item.probe, view) ? "green" : "missing";
};

const nextItem = (items: readonly BlueprintItem<ItemId>[], results: readonly ItemResult[]): ItemId | undefined => {
  const green = new Set(results.filter((result) => result.status === "green").map((result) => result.id));
  const open = items.filter((item) => !green.has(item.id));
  return (open.find((item) => item.after.every((id) => green.has(id))) ?? open[0])?.id;
};

export const evaluateBlueprint = (
  type: BlueprintType,
  view: ProjectView,
  approved: ReadonlySet<string> = new Set(),
): BlueprintBar => {
  const items = BLUEPRINTS[type];
  const results = items.map((item): ItemResult => ({
    id: item.id,
    area: item.area,
    status: statusOf(item, view, approved),
    check: item.probe.type,
  }));
  return {
    type,
    green: results.filter((result) => result.status === "green").length,
    total: results.length,
    items: results,
    next: nextItem(items, results),
    tree: view.tree,
  };
};
