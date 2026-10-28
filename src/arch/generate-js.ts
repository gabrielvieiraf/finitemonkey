import { globToRegExp } from "../core/glob.js";
import { type JsonValue, printJson } from "../generate/json-print.js";
import type { GeneratedFile } from "../generate/plan.js";
import type { ArchConfig, Layer } from "./config.js";
import { type Denied, deniedPairs, type DenyMessage, lastSegment, layerBases, slug } from "./pairs.js";

const importGroup = (layer: Layer): readonly string[] =>
  layerBases(layer).flatMap((base) => [`**/${lastSegment(base)}`, `**/${lastSegment(base)}/**`]);

export const restrictedImports = (config: ArchConfig, deny: DenyMessage): GeneratedFile => {
  const pairs = deniedPairs(config, deny);
  const blocks = config.layers.flatMap((layer): JsonValue[] => {
    const mine = pairs.filter((pair) => pair.from.name === layer.name);
    if (mine.length === 0) return [];
    const patterns = mine.map((pair) => ({ group: importGroup(pair.to), message: pair.message }));
    return [{ files: layer.paths, rules: { "no-restricted-imports": ["error", { patterns }] } }];
  });
  return { path: "eslint.arch.json", content: printJson(blocks) };
};

const entryRules = (config: ArchConfig): readonly JsonValue[] =>
  config.layers.flatMap((layer): JsonValue[] =>
    layer.public === undefined
      ? []
      : [{ target: [layer.name], allow: layer.public.map((glob) => glob.split("/").pop() ?? glob) }],
  );

const elementRule = (pairs: readonly Denied[], layer: Layer): JsonValue[] => {
  const mine = pairs.filter((pair) => pair.from.name === layer.name);
  return mine.map((pair) => ({ from: [layer.name], disallow: [pair.to.name], message: pair.message }));
};

export const boundaries = (config: ArchConfig, deny: DenyMessage): GeneratedFile => {
  const pairs = deniedPairs(config, deny);
  const entries = entryRules(config);
  const value: JsonValue = {
    settings: {
      "boundaries/elements": config.layers.map((layer) => ({ type: layer.name, pattern: layer.paths, mode: "full" })),
    },
    rules: {
      "boundaries/element-types": [
        "error",
        { default: "allow", rules: config.layers.flatMap((layer) => elementRule(pairs, layer)) },
      ],
      ...(entries.length === 0 ? {} : { "boundaries/entry-point": ["error", { default: "disallow", rules: entries }] }),
    },
  };
  return { path: "eslint.boundaries.json", content: printJson(value) };
};

const regexOf = (glob: string): string => globToRegExp(glob).source.replace(/\\\//g, "/");

const pathRegex = (layer: Layer): string => layer.paths.map(regexOf).join("|");

export const dependencyCruiser = (config: ArchConfig, deny: DenyMessage): GeneratedFile => {
  const forbidden: JsonValue[] = deniedPairs(config, deny).map((pair) => ({
    name: `${slug(pair.from.name)}-not-to-${slug(pair.to.name)}`,
    comment: pair.message,
    severity: "error",
    from: { path: pathRegex(pair.from) },
    to: { path: pathRegex(pair.to) },
  }));
  const privates: JsonValue[] = config.layers.flatMap((layer): JsonValue[] =>
    layer.public === undefined
      ? []
      : [
          {
            name: `${slug(layer.name)}-public-api`,
            comment: layer.public.join(", "),
            severity: "error",
            from: { pathNot: pathRegex(layer) },
            to: { path: pathRegex(layer), pathNot: layer.public.map(regexOf).join("|") },
          },
        ],
  );
  const value: JsonValue = {
    forbidden: [...forbidden, ...privates],
    options: { doNotFollow: { path: "node_modules" }, tsPreCompilationDeps: true },
  };
  return { path: ".dependency-cruiser.json", content: printJson(value) };
};
