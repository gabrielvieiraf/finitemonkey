import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { derivedSeed } from "./bench-plan.js";

export type Vars = Readonly<Record<string, string>>;

export const pickVars = (choices: Readonly<Record<string, readonly string[]>>, taskSeed: number): Vars =>
  Object.fromEntries(
    Object.entries(choices).map(([name, options]) => [
      name,
      options[derivedSeed(taskSeed, name) % Math.max(1, options.length)] ?? "",
    ]),
  );

export const renderText = (text: string, vars: Vars): string =>
  text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (whole, name: string) => vars[name] ?? whole);

export const filesUnder = (root: string): readonly string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat === undefined) continue;
      if (stat.isDirectory()) walk(path);
      else out.push(relative(root, path).split("\\").join("/"));
    }
  };
  walk(root);
  return out;
};

export const DELETE_MARKER = ".delete";

export const renderTree = (from: string, to: string, vars: Vars): void => {
  for (const file of filesUnder(from)) {
    if (file.endsWith(DELETE_MARKER)) continue;
    const target = join(to, renderText(file, vars));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderText(readFileSync(join(from, file), "utf8"), vars));
  }
};

export const deletions = (overlay: string): readonly string[] =>
  filesUnder(overlay)
    .filter((file) => file.endsWith(DELETE_MARKER))
    .map((file) => file.slice(0, -DELETE_MARKER.length));
