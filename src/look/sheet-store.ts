import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { slugOf } from "./node-capture.js";
import { LOOK_DIR } from "./paths.js";
import type { Kit, MiniEl } from "./probe-dom.js";
import type { Sheet } from "./sheet.js";

export const rootSelector = (
  kit: Kit,
  doc: { readonly querySelector: (selector: string) => MiniEl | null },
  selector: string,
): string | null => {
  const element = doc.querySelector(selector);
  return element === null ? null : kit.selectorOf(element);
};

export const sheetsDir = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, LOOK_DIR, "sheets"));

export const approvedSheetPath = (paths: FmPaths, route: string): AbsolutePath =>
  toAbsolutePath(join(sheetsDir(paths), `${slugOf(route)}.json`));

const isSheet = (value: unknown): value is Sheet =>
  isRecord(value) &&
  value["schema"] === "finitemonkey/look-sheet@1" &&
  typeof value["route"] === "string" &&
  Array.isArray(value["views"]) &&
  Array.isArray(value["variables"]);

export const readSheet = (runtime: Pick<Runtime, "readText">, file: AbsolutePath): Sheet | undefined => {
  const text = runtime.readText(file);
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return parsed?.ok === true && isSheet(parsed.value) ? parsed.value : undefined;
};
