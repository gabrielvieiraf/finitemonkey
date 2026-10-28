import { matchesAny } from "../core/glob.js";
import type { PlannedFront, WavePlan } from "./plan-input.js";

export const REFUSALS = [
  "overlapping-paths",
  "duplicate-port",
  "duplicate-prefix",
  "duplicate-namespace",
  "dependency-cycle",
  "unknown-blocker",
  "small-task",
  "shared-files",
  "unknown-scope",
  "cross-cutting-rename",
  "too-few-files",
  "too-few-fronts",
] as const;

export type RefusalRule = (typeof REFUSALS)[number];

export interface Refusal {
  readonly rule: RefusalRule;
  readonly fronts: readonly string[];
  readonly detail: string;
}

export const MIN_FILES_PER_FRONT = 3;

const staticPrefix = (glob: string): string => glob.replace(/^\.\//, "").split(/[*?[{]/)[0] ?? "";

const globsOverlap = (left: string, right: string, files: readonly string[]): boolean => {
  const a = staticPrefix(left);
  const b = staticPrefix(right);
  const openA = a !== left.replace(/^\.\//, "");
  const openB = b !== right.replace(/^\.\//, "");
  if ((openA && b.startsWith(a)) || (openB && a.startsWith(b)) || a === b) return true;
  return files.some((file) => matchesAny(file, [left]) && matchesAny(file, [right]));
};

const pairs = <T>(items: readonly T[]): readonly (readonly [T, T])[] =>
  items.flatMap((left, index) => items.slice(index + 1).map((right) => [left, right] as const));

const overlapping = (fronts: readonly PlannedFront[], files: readonly string[]): readonly Refusal[] =>
  pairs(fronts).flatMap(([left, right]) => {
    const hit = left.paths.flatMap((a) =>
      right.paths.filter((b) => globsOverlap(a, b, files)).map((b) => `${a} ~ ${b}`),
    );
    return hit.length === 0
      ? []
      : [{ rule: "overlapping-paths" as const, fronts: [left.id, right.id], detail: hit.join(", ") }];
  });

const duplicates = (
  fronts: readonly PlannedFront[],
  rule: RefusalRule,
  pick: (front: PlannedFront) => string | number | null,
): readonly Refusal[] => {
  const seen = new Map<string, string[]>();
  for (const front of fronts) {
    const value = pick(front);
    if (value !== null) seen.set(String(value), [...(seen.get(String(value)) ?? []), front.id]);
  }
  return [...seen].filter(([, ids]) => ids.length > 1).map(([value, ids]) => ({ rule, fronts: ids, detail: value }));
};

const cycle = (fronts: readonly PlannedFront[]): readonly string[] | undefined => {
  const edges = new Map(fronts.map((front) => [front.id, front.blockedBy]));
  const state = new Map<string, "visiting" | "done">();
  const walk = (id: string, path: readonly string[]): readonly string[] | undefined => {
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    if (state.get(id) === "done") return undefined;
    state.set(id, "visiting");
    for (const next of edges.get(id) ?? []) {
      const found = walk(next, [...path, id]);
      if (found !== undefined) return found;
    }
    state.set(id, "done");
    return undefined;
  };
  for (const front of fronts) {
    const found = walk(front.id, []);
    if (found !== undefined) return found;
  }
  return undefined;
};

const graphRefusals = (fronts: readonly PlannedFront[]): readonly Refusal[] => {
  const ids = new Set(fronts.map((front) => front.id));
  const unknown = fronts.flatMap((front) =>
    front.blockedBy
      .filter((id) => !ids.has(id))
      .map((id) => ({ rule: "unknown-blocker" as const, fronts: [front.id], detail: id })),
  );
  const loop = cycle(fronts.filter((front) => front.blockedBy.every((id) => ids.has(id))));
  return [
    ...unknown,
    ...(loop === undefined ? [] : [{ rule: "dependency-cycle" as const, fronts: loop, detail: loop.join(" -> ") }]),
  ];
};

const sharedFiles = (fronts: readonly PlannedFront[]): readonly Refusal[] => {
  const append = fronts.flatMap((front) => front.append);
  const counts = new Map<string, string[]>();
  for (const front of fronts) {
    for (const file of front.shared.filter((path) => !matchesAny(path, append))) {
      counts.set(file, [...(counts.get(file) ?? []), front.id]);
    }
  }
  const shared = [...counts.keys()];
  return shared.length > 1
    ? [{ rule: "shared-files", fronts: [...new Set([...counts.values()].flat())], detail: shared.join(", ") }]
    : [];
};

const paysOff = (plan: WavePlan, files: readonly string[]): readonly Refusal[] => [
  ...(plan.size === "S" || plan.size === "M" ? [{ rule: "small-task" as const, fronts: [], detail: plan.size }] : []),
  ...(plan.fronts.length < 2
    ? [
        {
          rule: "too-few-fronts" as const,
          fronts: plan.fronts.map((front) => front.id),
          detail: String(plan.fronts.length),
        },
      ]
    : []),
  ...plan.fronts
    .filter((front) => front.paths.length === 0)
    .map((front) => ({ rule: "unknown-scope" as const, fronts: [front.id], detail: "" })),
  ...plan.fronts
    .filter((front) => front.rename)
    .map((front) => ({ rule: "cross-cutting-rename" as const, fronts: [front.id], detail: "" })),
  ...plan.fronts
    .filter((front) => front.paths.length > 0)
    .flatMap((front) => {
      const count = front.files ?? files.filter((file) => matchesAny(file, front.paths)).length;
      return count < MIN_FILES_PER_FRONT
        ? [{ rule: "too-few-files" as const, fronts: [front.id], detail: String(count) }]
        : [];
    }),
];

export const refusals = (plan: WavePlan, files: readonly string[]): readonly Refusal[] => [
  ...overlapping(plan.fronts, files),
  ...duplicates(plan.fronts, "duplicate-port", (front) => front.port),
  ...duplicates(plan.fronts, "duplicate-prefix", (front) => front.shotsPrefix),
  ...duplicates(plan.fronts, "duplicate-namespace", (front) => front.i18nNs),
  ...graphRefusals(plan.fronts),
  ...sharedFiles(plan.fronts),
  ...paysOff(plan, files),
];
