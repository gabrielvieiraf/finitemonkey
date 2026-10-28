import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import type { PageLayout } from "./layout.js";
import { LOOK_DIR, lookDir } from "./paths.js";

export const LAYOUT_FILE = "layout.json";
export const APPROVED_FILE = "approved.json";

export interface ApprovedScreen {
  readonly route: string;
  readonly viewport: number;
  readonly structure: readonly string[];
  readonly at: string;
}

const approvedPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, LOOK_DIR, APPROVED_FILE));

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const layoutOf = (value: unknown): PageLayout | undefined => {
  if (!isRecord(value)) return undefined;
  const { route, viewport } = value;
  if (typeof route !== "string" || typeof viewport !== "number") return undefined;
  return { route, viewport, structure: strings(value["structure"]) };
};

const listOf = (text: string, key: string): readonly unknown[] => {
  const parsed = parseJsonObject(text);
  const list = parsed.ok ? parsed.value[key] : undefined;
  return Array.isArray(list) ? list : [];
};

export const writeLayouts = (
  runtime: Pick<Runtime, "writeText">,
  paths: FmPaths,
  tree: string,
  pages: readonly PageLayout[],
): void => {
  runtime.writeText(
    toAbsolutePath(join(lookDir(paths, tree), LAYOUT_FILE)),
    `${JSON.stringify({ pages: pages.map((page) => ({ ...page, structure: [...page.structure] })) })}\n`,
  );
};

export const latestLayouts = (
  runtime: Pick<Runtime, "readText" | "listDir" | "stat">,
  paths: FmPaths,
): readonly PageLayout[] => {
  const dirs = runtime.listDir(toAbsolutePath(join(paths.dir, LOOK_DIR)));
  if (!dirs.ok) return [];
  const newest = dirs.value
    .map((name) => toAbsolutePath(join(paths.dir, LOOK_DIR, name, LAYOUT_FILE)))
    .map((file) => ({ file, at: runtime.stat(file)?.mtimeMs ?? -1 }))
    .filter((entry) => entry.at >= 0)
    .sort((left, right) => right.at - left.at)[0];
  if (newest === undefined) return [];
  const text = runtime.readText(newest.file);
  return text.ok ? listOf(text.value, "pages").flatMap((item) => layoutOf(item) ?? []) : [];
};

export const readApproved = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly ApprovedScreen[] => {
  const text = runtime.readText(approvedPath(paths));
  if (!text.ok) return [];
  return listOf(text.value, "screens").flatMap((item) => {
    const layout = layoutOf(item);
    const at = isRecord(item) ? item["at"] : undefined;
    return layout === undefined || typeof at !== "string" ? [] : [{ ...layout, at }];
  });
};

export const approveRoute = (
  runtime: Pick<Runtime, "readText" | "writeText" | "now">,
  paths: FmPaths,
  route: string,
  pages: readonly PageLayout[],
): readonly ApprovedScreen[] => {
  const at = runtime.now();
  const fresh = pages.filter((page) => page.route === route).map((page) => ({ ...page, at }));
  const kept = readApproved(runtime, paths).filter((screen) => screen.route !== route);
  if (fresh.length > 0) {
    runtime.writeText(approvedPath(paths), `${JSON.stringify({ screens: [...kept, ...fresh] }, null, 2)}\n`);
  }
  return fresh;
};
