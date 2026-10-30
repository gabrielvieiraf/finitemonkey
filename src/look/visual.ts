import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { LOOK_DIR } from "./paths.js";
import type { ProbeBox } from "./probe.js";
import { issue, type UxPage } from "./ux.js";

export const VISUAL_FEATURE = "visual-approve";
export const VERDICTS_FILE = "verdicts.json";
export const APPROVED_IMAGES = "approved";
export const DEFAULT_THRESHOLD = 0.2;
export const DEFAULT_MAX_DIFF_PIXELS = 0;
export const CELL_PX = 16;

export interface VisualTolerance {
  readonly threshold: number;
  readonly maxDiffPixels: number;
}

export interface Verdict {
  readonly route: string;
  readonly tree: string;
  readonly verdict: "approved" | "rejected";
  readonly by: string;
  readonly reason: string;
  readonly at: string;
}

export interface VisualDiff {
  readonly route: string;
  readonly viewport: number;
  readonly changed: number;
  readonly regions: readonly ProbeBox[];
  readonly sideBySide: string | undefined;
  readonly sizeChanged: boolean;
}

export const verdictsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, LOOK_DIR, VERDICTS_FILE));

export const approvedImagesDir = (paths: FmPaths): AbsolutePath =>
  toAbsolutePath(join(paths.dir, LOOK_DIR, APPROVED_IMAGES));

const verdictOf = (value: unknown): Verdict | undefined => {
  if (!isRecord(value)) return undefined;
  const { route, tree, verdict, by, reason, at } = value;
  if (typeof route !== "string" || typeof tree !== "string" || typeof at !== "string") return undefined;
  if (verdict !== "approved" && verdict !== "rejected") return undefined;
  return {
    route,
    tree,
    verdict,
    by: typeof by === "string" ? by : "",
    reason: typeof reason === "string" ? reason : "",
    at,
  };
};

export const readVerdicts = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Verdict[] => {
  const raw = runtime.readText(verdictsPath(paths));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  const list = parsed?.ok === true ? parsed.value["verdicts"] : undefined;
  return Array.isArray(list) ? list.flatMap((item: unknown) => verdictOf(item) ?? []) : [];
};

export const writeVerdicts = (
  runtime: Pick<Runtime, "writeText">,
  paths: FmPaths,
  verdicts: readonly Verdict[],
): boolean => runtime.writeText(verdictsPath(paths), `${JSON.stringify({ verdicts }, null, 2)}\n`).ok;

export const verdictFor = (verdicts: readonly Verdict[], route: string, tree: string): Verdict | undefined =>
  [...verdicts].reverse().find((item) => item.route === route && item.tree === tree);

export const visualPages = (
  diffs: readonly VisualDiff[],
  verdicts: readonly Verdict[],
  tree: string,
): readonly UxPage[] =>
  diffs.flatMap((diff) => {
    if (diff.changed === 0 && !diff.sizeChanged) return [];
    const verdict = verdictFor(verdicts, diff.route, tree);
    if (verdict?.verdict === "approved") return [];
    const where = diff.sideBySide === undefined ? "" : ` (${diff.sideBySide})`;
    const regions = `${String(diff.regions.length)} changed region${diff.regions.length === 1 ? "" : "s"}`;
    const rule = verdict?.verdict === "rejected" ? ("visual/rejected" as const) : ("visual/pending" as const);
    const detail =
      verdict?.verdict === "rejected"
        ? `rejected by ${verdict.by}: ${verdict.reason}`
        : `${regions}, ${String(diff.changed)} pixels against the approved image${where}; needs the person's verdict`;
    return [
      {
        feature: VISUAL_FEATURE,
        route: diff.route,
        viewport: diff.viewport,
        issues:
          diff.regions.length === 0
            ? [issue(rule, "html", detail)]
            : diff.regions.map((box) =>
                issue(rule, `region ${String(Math.round(box.x))},${String(Math.round(box.y))}`, detail, { box }),
              ),
      },
    ];
  });

export interface Cell {
  readonly col: number;
  readonly row: number;
}

export const regionsOf = (cells: readonly Cell[], size: number): readonly ProbeBox[] => {
  const key = (cell: Cell): string => `${String(cell.col)},${String(cell.row)}`;
  const left = new Map(cells.map((cell) => [key(cell), cell]));
  const boxes: ProbeBox[] = [];
  for (const start of cells) {
    if (!left.has(key(start))) continue;
    left.delete(key(start));
    const group = [start];
    for (const cell of group) {
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = left.get(key({ col: cell.col + dc, row: cell.row + dr }));
        if (next === undefined) continue;
        left.delete(key(next));
        group.push(next);
      }
    }
    const cols = group.map((cell) => cell.col);
    const rows = group.map((cell) => cell.row);
    const x = Math.min(...cols) * size;
    const y = Math.min(...rows) * size;
    boxes.push({ x, y, w: (Math.max(...cols) + 1) * size - x, h: (Math.max(...rows) + 1) * size - y });
  }
  return boxes;
};
