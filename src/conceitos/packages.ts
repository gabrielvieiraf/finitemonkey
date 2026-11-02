import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { conceptPathOf } from "./concepts.js";
import type { PackageMap } from "./recognize.js";

export const CONCEPT_MAP_FILE = "conceitos-map.json";
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const MAX_KEYWORDS = 30;

const readObject = (runtime: Pick<Runtime, "readText">, path: string): Readonly<Record<string, unknown>> => {
  const text = runtime.readText(toAbsolutePath(path));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return parsed?.ok === true && isRecord(parsed.value) ? parsed.value : {};
};

const declaredPackages = (raw: unknown): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(isRecord(raw) ? raw : {}).flatMap(([name, concept]) => {
      const id = typeof concept === "string" ? conceptPathOf(concept) : undefined;
      return id === undefined || !PACKAGE_NAME.test(name) ? [] : [[name, id]];
    }),
  );

export const installedKeywords =
  (runtime: Pick<Runtime, "readText">, root: string) =>
  (name: string): readonly string[] => {
    if (!PACKAGE_NAME.test(name)) return [];
    const keywords = readObject(runtime, join(root, "node_modules", name, "package.json"))["keywords"];
    return Array.isArray(keywords)
      ? keywords.filter((item): item is string => typeof item === "string").slice(0, MAX_KEYWORDS)
      : [];
  };

export const packageMapOf = (runtime: Pick<Runtime, "readText">, paths: FmPaths): PackageMap => ({
  packages: declaredPackages(readObject(runtime, join(paths.dir, CONCEPT_MAP_FILE))["packages"]),
  keywordsOf: installedKeywords(runtime, paths.root),
});
