import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { toPosixPath } from "../../core/posix-path.js";
import type { Runtime } from "../../core/runtime.js";
import { type Change, EXCLUDE_FM, fileAt, type Git } from "../git.js";
import { importsOrigin } from "./imports.js";
import { definesName, definitionsIn, type Language, languageOf } from "./languages.js";

export const MAX_SYMBOLS = 200;

export interface RemovedSymbol {
  readonly name: string;
  readonly language: Language;
  readonly origins: readonly string[];
}

export interface CallSite {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

type Reader = Pick<Runtime, "readText">;

const current = (runtime: Reader, root: AbsolutePath, path: string): string => {
  const text = runtime.readText(toAbsolutePath(join(root, path)));
  return text.ok ? text.value : "";
};

const keyOf = (language: Language, name: string): string => `${language.id}\0${name}`;

const redefinedNames = (runtime: Reader, git: Git, changes: readonly Change[]): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const change of changes) {
    const language = languageOf(change.path);
    if (language === undefined || change.status === "D") continue;
    for (const name of definitionsIn(language, current(runtime, git.cwd, change.path))) keys.add(keyOf(language, name));
  }
  return keys;
};

export const removedSymbols = (
  runtime: Reader,
  git: Git,
  base: string,
  changes: readonly Change[],
): readonly RemovedSymbol[] => {
  const redefined = redefinedNames(runtime, git, changes);
  const found = new Map<string, RemovedSymbol>();
  for (const change of changes) {
    const language = languageOf(change.oldPath ?? change.path);
    if (language === undefined || change.status === "A") continue;
    const before = definitionsIn(language, fileAt(git, base, change.oldPath ?? change.path) ?? "");
    const origins = [change.path, ...(change.oldPath === undefined ? [] : [change.oldPath])];
    for (const name of before) {
      const key = keyOf(language, name);
      if (redefined.has(key)) continue;
      const prior = found.get(key);
      found.set(key, { name, language, origins: [...(prior?.origins ?? []), ...origins] });
    }
  }
  return [...found.values()].slice(0, MAX_SYMBOLS);
};

interface GrepHit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const parseGrep = (output: string): readonly GrepHit[] =>
  output
    .split("\n")
    .filter((row) => row !== "")
    .flatMap((row) => {
      const [file = "", line = "", ...rest] = row.split("\0");
      const number = Number(line);
      return file === "" || !Number.isInteger(number)
        ? []
        : [{ file: toPosixPath(file), line: number, text: rest.join("\0") }];
    });

const grep = (git: Git, names: readonly string[]): readonly GrepHit[] => {
  if (names.length === 0) return [];
  const patterns = names.flatMap((name) => ["-e", name]);
  return parseGrep(
    git.out(["grep", "-n", "-z", "-w", "-I", "--untracked", "--no-color", ...patterns, "--", ".", EXCLUDE_FM]) ?? "",
  );
};

const mentions = (text: string, name: string): boolean =>
  new RegExp(`(?<![\\w$])${name.replace(/[$?!]/g, "\\$&")}(?![\\w$])`).test(text);

export const callSites = (runtime: Reader, git: Git, symbols: readonly RemovedSymbol[]): readonly CallSite[] => {
  const hits = grep(git, [...new Set(symbols.map((symbol) => symbol.name))]);
  const texts = new Map<string, string>();
  const textOf = (file: string): string => {
    const cached = texts.get(file) ?? current(runtime, git.cwd, file);
    texts.set(file, cached);
    return cached;
  };
  return symbols.flatMap((symbol) =>
    hits
      .filter((hit) => languageOf(hit.file)?.id === symbol.language.id && mentions(hit.text, symbol.name))
      .filter((hit) => !symbol.language.comment.test(hit.text) && !definesName(symbol.language, hit.text, symbol.name))
      .filter((hit) => importsOrigin(symbol.language, hit.file, textOf(hit.file), symbol.origins))
      .map((hit) => ({ name: symbol.name, file: hit.file, line: hit.line })),
  );
};
