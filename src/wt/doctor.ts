import type { Env } from "../core/context.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Classified } from "./classify.js";
import { classifyAll, type Inventory } from "./inventory.js";
import { placeProblems, tempDirs } from "./place.js";

export const WT_FINDINGS = [
  "temp",
  "nested",
  "slow",
  "prunable",
  "orphan",
  "unregistered",
  "branch-held",
  "stale",
  "claude-cleanup-bug",
  "registry-unreadable",
] as const;

export type WtFindingKind = (typeof WT_FINDINGS)[number];

export interface WtFinding {
  readonly kind: WtFindingKind;
  readonly path: string;
  readonly detail: string;
}

export const BUGGY_CLAUDE_VERSIONS: readonly string[] = ["2.1.141"];

const finding = (kind: WtFindingKind, path: string, detail = ""): WtFinding => ({
  kind,
  path: toPosixPath(path),
  detail,
});

const placeFindings = (inventory: Inventory, env: Env): readonly WtFinding[] => {
  const linked = inventory.trees.filter((tree) => !tree.main).map((tree) => tree.path);
  return linked.flatMap((path) =>
    placeProblems(path, { mainRoot: inventory.mainRoot, temps: tempDirs(env), linked }).map((problem) =>
      finding(problem, path),
    ),
  );
};

const itemFindings = (item: Classified): readonly WtFinding[] => [
  ...(item.tree?.prunable === true ? [finding("prunable", item.path)] : []),
  ...(item.tree === undefined ? [finding("orphan", item.path)] : []),
  ...(item.tree !== undefined && item.entry === undefined ? [finding("unregistered", item.path)] : []),
  ...(item.cls === "contained" && item.branch !== null ? [finding("branch-held", item.path, item.branch)] : []),
];

const isStale = (inventory: Inventory, item: Classified): boolean => {
  if (item.activityAt === null) return false;
  const age = Date.parse(inventory.context.runtime.now()) - Date.parse(item.activityAt);
  return age > inventory.context.staleDays * 86_400_000;
};

const claudeFinding = (inventory: Inventory): readonly WtFinding[] => {
  const probe = inventory.context.runtime.probe("claude", ["--version"], 3000);
  const version = /\d+\.\d+\.\d+/.exec(probe.stdout)?.[0];
  return version !== undefined && BUGGY_CLAUDE_VERSIONS.includes(version)
    ? [finding("claude-cleanup-bug", "", version)]
    : [];
};

export const wtDoctor = (inventory: Inventory, env: Env): readonly WtFinding[] => {
  const items = classifyAll(inventory);
  return [
    ...(inventory.registryError === undefined ? [] : [finding("registry-unreadable", "", inventory.registryError)]),
    ...placeFindings(inventory, env),
    ...items.flatMap(itemFindings),
    ...items
      .filter((item) => item.tree !== undefined && isStale(inventory, item))
      .map((item) => finding("stale", item.path, item.activityAt ?? "")),
    ...claudeFinding(inventory),
  ];
};
