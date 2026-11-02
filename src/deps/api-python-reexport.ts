import { dirname, join } from "node:path";

import { type ApiRuntime, read, type Signature, type Surface } from "./api-parse.js";

export const MAX_REEXPORT_DEPTH = 5;

export interface PyModule {
  readonly path: string;
  readonly text: string;
}

interface Reexport {
  readonly module: string;
  readonly names: readonly { readonly source: string; readonly name: string }[];
}

const FROM_IMPORT = /^from\s+(\.*[\w.]*)\s+import\s+\(?([^)\n]+)\)?/gm;

const reexportsOf = (text: string): readonly Reexport[] =>
  [...text.matchAll(FROM_IMPORT)].map((match) => ({
    module: match[1] ?? "",
    names: (match[2] ?? "").split(",").flatMap((item) => {
      const [source = "", name = source] = item.trim().split(/\s+as\s+/);
      return source === "" || source === "*" ? [] : [{ source, name }];
    }),
  }));

const moduleAt = (runtime: ApiRuntime, base: string): PyModule | undefined => {
  for (const path of [`${base}.py`, join(base, "__init__.py")]) {
    const text = read(runtime, path);
    if (text !== undefined) return { path, text };
  }
  return undefined;
};

const targetOf = (site: string, pkg: string, from: string, module: string): string | undefined => {
  const dots = /^\.*/.exec(module)?.[0].length ?? 0;
  const parts = module
    .slice(dots)
    .split(".")
    .filter((part) => part !== "");
  if (parts.length === 0) return undefined;
  if (dots === 0) return parts[0] === pkg ? join(site, ...parts) : undefined;
  let base = dirname(from);
  for (let level = 1; level < dots; level += 1) base = dirname(base);
  return join(base, ...parts);
};

const isPlaceholder = (signature: Signature): boolean =>
  signature.required === 0 && signature.max === Infinity && signature.keywords === undefined && !signature.deprecated;

export const followReexports = (
  runtime: ApiRuntime,
  site: string,
  pkg: string,
  start: PyModule,
  surfaceOf: (text: string) => Surface,
  depth = 0,
): Surface => {
  const surface = surfaceOf(start.text);
  if (depth >= MAX_REEXPORT_DEPTH) return surface;
  const exports = new Map<string, Signature>(surface.exports);
  for (const reexport of reexportsOf(start.text)) {
    const base = targetOf(site, pkg, start.path, reexport.module);
    const target = base === undefined ? undefined : moduleAt(runtime, base);
    if (target === undefined) continue;
    const inner = followReexports(runtime, site, pkg, target, surfaceOf, depth + 1);
    for (const { source, name } of reexport.names) {
      const signature = inner.exports.get(source);
      const known = exports.get(name);
      if (signature !== undefined && (known === undefined || isPlaceholder(known))) exports.set(name, signature);
    }
  }
  return { ...surface, exports };
};
