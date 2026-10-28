import type { ArchConfig, Layer } from "./config.js";

export interface Denied {
  readonly from: Layer;
  readonly to: Layer;
  readonly message: string;
}

export type DenyMessage = (from: string, allowed: readonly string[]) => string;

export const deniedPairs = (config: ArchConfig, notAllowed: DenyMessage): readonly Denied[] =>
  config.layers.flatMap((from) =>
    config.layers.flatMap((to): Denied[] => {
      if (to.name === from.name) return [];
      const rule = config.forbid.find((item) => item.from === from.name && item.to === to.name);
      if (rule !== undefined) return [{ from, to, message: rule.message }];
      if (from.allow !== undefined && !from.allow.includes(to.name)) {
        return [{ from, to, message: notAllowed(from.name, from.allow) }];
      }
      return [];
    }),
  );

export const globBase = (glob: string): string => {
  const parts = glob.replace(/^\.\//, "").split("/");
  const wild = parts.findIndex((part) => /[*?[]/.test(part));
  return parts
    .slice(0, wild === -1 ? parts.length : wild)
    .join("/")
    .replace(/\/$/, "");
};

export const layerBases = (layer: Layer): readonly string[] => [
  ...new Set(layer.paths.map(globBase).filter((base) => base !== "")),
];

export const lastSegment = (path: string): string =>
  path
    .split("/")
    .filter((part) => part !== "")
    .pop() ?? path;

const JVM_ROOTS = /^(?:.*\/)?src\/(?:main|test)\/(?:java|kotlin)\//;

export const dottedModule = (base: string): string =>
  base
    .replace(JVM_ROOTS, "")
    .replace(/^src\//, "")
    .split("/")
    .filter((part) => part !== "")
    .join(".");

export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const camel = (text: string): string =>
  slug(text)
    .split("-")
    .map((part, index) => (index === 0 ? part : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`))
    .join("");
