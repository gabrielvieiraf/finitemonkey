import { posix } from "node:path";

import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { DetectorSources } from "./detector-sources.js";
import type { QualityFinding } from "./ratchet.js";
import { lineOfText } from "./specifiers.js";

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const PLUGIN_PREFIX =
  /^(?:eslint-plugin-|eslint-config-|prettier-plugin-|babel-plugin-|babel-preset-|stylelint-config-)/;

const manifestOf = (text: string | undefined): JsonObject | undefined => {
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  return parsed?.ok === true ? parsed.value : undefined;
};

export const declaredDependencies = (manifest: JsonObject | undefined): ReadonlySet<string> =>
  new Set(
    SECTIONS.flatMap((section) => {
      const value = manifest?.[section];
      return isRecord(value) ? Object.keys(value) : [];
    }),
  );

const binNames = (sources: DetectorSources, dir: string, name: string): readonly string[] => {
  const bin = manifestOf(sources.after(posix.join(dir, "node_modules", name, "package.json")))?.["bin"];
  if (typeof bin === "string") return [name.split("/").pop() ?? name];
  return isRecord(bin) ? Object.keys(bin) : [];
};

export const lookupNames = (name: string, bins: readonly string[]): readonly string[] => {
  const scope = name.startsWith("@") ? (name.split("/")[0] ?? name) : undefined;
  const local = name.split("/").pop() ?? name;
  const short = PLUGIN_PREFIX.test(local) ? local.replace(PLUGIN_PREFIX, "") : undefined;
  const scoped = scope !== undefined && /^(?:eslint-plugin|eslint-config)$/.test(local) ? scope : undefined;
  return [
    ...new Set([name, ...bins, ...(short === undefined ? [] : [short]), ...(scoped === undefined ? [] : [scoped])]),
  ];
};

const scriptsText = (manifest: JsonObject): string => {
  const scripts = manifest["scripts"];
  return isRecord(scripts)
    ? Object.values(scripts)
        .filter((value) => typeof value === "string")
        .join("\n")
    : "";
};

const mentioned = (text: string, word: string): boolean =>
  new RegExp(`(?<![\\w@/-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text);

const unusedIn = (sources: DetectorSources, file: string): readonly QualityFinding[] => {
  const text = sources.after(file);
  const after = manifestOf(text);
  if (text === undefined || after === undefined) return [];
  const old = declaredDependencies(manifestOf(sources.before(file)));
  const scripts = scriptsText(after);
  const dir = posix.dirname(file);
  return [...declaredDependencies(after)]
    .filter((name) => !old.has(name) && !name.startsWith("@types/"))
    .filter((name) => {
      const names = lookupNames(name, binNames(sources, dir, name));
      return !names.some((word) => mentioned(scripts, word) || sources.referenced(word, [file]));
    })
    .map((name) => ({
      rule: "unused_dependency" as const,
      level: "block" as const,
      file,
      line: lineOfText(text, `"${name}"`),
      params: { name },
    }));
};

export const unusedDependencyFindings = (sources: DetectorSources): readonly QualityFinding[] =>
  sources.changed
    .filter((file) => posix.basename(file) === "package.json" && !file.includes("node_modules/"))
    .flatMap((file) => unusedIn(sources, file));
