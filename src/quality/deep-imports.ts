import { posix } from "node:path";

import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { DetectorSources } from "./detector-sources.js";
import type { QualityFinding } from "./ratchet.js";
import { lineOfText, moduleSpecifiers, packageSpecifier } from "./specifiers.js";
import { isTsFamily } from "./ts-api.js";

const INTERNAL = new Set(["src", "lib", "dist", "internal", "_internal", "build", "esm", "cjs", "es"]);

const exportKeys = (manifest: JsonObject): readonly string[] | undefined => {
  const declared = manifest["exports"];
  if (declared === undefined || declared === null) return undefined;
  if (!isRecord(declared)) return ["."];
  const keys = Object.keys(declared);
  return keys.some((key) => key.startsWith(".")) ? keys : ["."];
};

const keyMatches = (key: string, target: string): boolean => {
  if (key === target) return true;
  if (key.endsWith("/")) return target.startsWith(key);
  const star = key.indexOf("*");
  if (star < 0) return false;
  const head = key.slice(0, star);
  const tail = key.slice(star + 1);
  return target.length >= head.length + tail.length && target.startsWith(head) && target.endsWith(tail);
};

export const pastEntryPoints = (manifest: JsonObject, subpath: string): boolean => {
  const keys = exportKeys(manifest);
  if (keys === undefined) return subpath.split("/").some((segment) => INTERNAL.has(segment));
  return !keys.some((key) => keyMatches(key, `./${subpath}`));
};

const manifestNear = (sources: DetectorSources, file: string, name: string): JsonObject | undefined => {
  const dirs = posix.dirname(file).split("/");
  for (let size = dirs.length; size >= 0; size -= 1) {
    const base = dirs
      .slice(0, size)
      .filter((part) => part !== ".")
      .join("/");
    const text = sources.after(posix.join(base, "node_modules", name, "package.json"));
    if (text === undefined) continue;
    const parsed = parseJsonObject(text);
    return parsed.ok ? parsed.value : undefined;
  }
  return undefined;
};

const deepIn = (sources: DetectorSources, file: string, after: string): readonly QualityFinding[] => {
  const before = sources.before(file);
  const old = new Set(before === undefined ? [] : moduleSpecifiers(before));
  return moduleSpecifiers(after).flatMap((specifier): QualityFinding[] => {
    const target = old.has(specifier) ? undefined : packageSpecifier(specifier);
    if (target === undefined || target.subpath === "") return [];
    const manifest = manifestNear(sources, file, target.name);
    if (manifest === undefined || !pastEntryPoints(manifest, target.subpath)) return [];
    const line = lineOfText(after, specifier);
    return [{ rule: "deep_import", level: "block", file, line, params: { specifier, package: target.name } }];
  });
};

export const deepImportFindings = (sources: DetectorSources, touched: readonly string[]): readonly QualityFinding[] =>
  touched.filter(isTsFamily).flatMap((file) => {
    const after = sources.after(file);
    return after === undefined ? [] : deepIn(sources, file, after);
  });
