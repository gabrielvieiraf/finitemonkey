import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type DocUnit, readUnits } from "./docs.js";
import { closedByMessage, commitsIn } from "./release.js";

export interface Touched {
  readonly paths: readonly string[];
  readonly symbols: readonly string[];
  readonly features: readonly string[];
  readonly issues: readonly number[];
}

export interface Mention {
  readonly file: string;
  readonly line: number;
  readonly says: string;
  readonly mentions: readonly string[];
  readonly changedHere: boolean;
}

const EXPORTED =
  /^[+-]\s*export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function\*?|class|interface|type)\s+([A-Za-z_$][\w$]*)/;
const MIN_SYMBOL = 6;
const MAX_SAYS = 200;

export const symbolsInDiff = (diff: string): readonly string[] =>
  [
    ...new Set(
      diff.split("\n").flatMap((line) => {
        const name = EXPORTED.exec(line)?.[1];
        return name !== undefined && name.length >= MIN_SYMBOL ? [name] : [];
      }),
    ),
  ].sort();

const FEATURE_CONTEXT = /feature|guard|mode/i;

export const featuresInDiff = (diff: string, features: ReadonlySet<string>): readonly string[] =>
  [
    ...new Set(
      diff
        .split("\n")
        .filter((line) => /^[+-][^+-]/.test(line))
        .flatMap((line) =>
          [...line.matchAll(/"([a-z][a-z0-9-]+)"/g)]
            .map((match) => match[1] ?? "")
            .filter((id) => features.has(id) && (id.includes("-") || FEATURE_CONTEXT.test(line))),
        ),
    ),
  ].sort();

const CODE_ONLY = /^(?!test\/|tests\/|.*\.test\.|.*\/fixtures\/|dist\/).*/;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchersOf = (touched: Touched): readonly (readonly [string, RegExp])[] => [
  ...touched.paths.map((path) => [path, new RegExp(`(?<![\\w/.-])${escape(path)}(?![\\w/-])`)] as const),
  ...touched.symbols.map((name) => [name, new RegExp(`\`[^\`]*\\b${escape(name)}\\b[^\`]*\``)] as const),
  ...touched.features.map((id) => [id, new RegExp(`\`${escape(id)}\``)] as const),
  ...touched.issues.map((issue) => [`#${String(issue)}`, new RegExp(`(?<![\\w/&])#${String(issue)}\\b`)] as const),
];

export const mentionsOf = (units: readonly DocUnit[], touched: Touched, changed: ReadonlySet<string>): Mention[] => {
  const matchers = matchersOf(touched);
  return units.flatMap((unit): Mention[] => {
    const hits = matchers.filter(([label, pattern]) => label !== unit.file && pattern.test(unit.text));
    if (hits.length === 0) return [];
    const says = unit.text.length > MAX_SAYS ? `${unit.text.slice(0, MAX_SAYS - 3)}...` : unit.text;
    return [
      {
        file: unit.file,
        line: unit.line,
        says,
        mentions: hits.map(([label]) => label),
        changedHere: changed.has(unit.file),
      },
    ];
  });
};

const BRANCH_ISSUE = /(?:^|\/)(?:issue-)?(\d+)-/;

const branchIssue = (runtime: Pick<Runtime, "git">, root: AbsolutePath): readonly number[] => {
  const branch = runtime.git(["rev-parse", "--abbrev-ref", "HEAD"], root).stdout.trim();
  const found = BRANCH_ISSUE.exec(branch)?.[1];
  return found === undefined ? [] : [Number(found)];
};

const against = (base: string, worktree: boolean): string => (worktree ? base : `${base}...HEAD`);

export const changedFiles = (
  runtime: Pick<Runtime, "git">,
  root: AbsolutePath,
  base: string,
  worktree = false,
): readonly string[] => {
  const names = runtime.git(["diff", "--name-only", against(base, worktree)], root);
  return names.ok ? names.stdout.split("\n").filter((path) => path !== "") : [];
};

export const touchedSince = (
  runtime: Pick<Runtime, "git">,
  root: AbsolutePath,
  base: string,
  features: ReadonlySet<string>,
  worktree = false,
): Touched => {
  const paths = changedFiles(runtime, root, base, worktree).filter((path) => !path.endsWith(".md"));
  const code = paths.filter((path) => CODE_ONLY.test(path));
  const diff =
    code.length === 0 ? undefined : runtime.git(["diff", "--unified=0", against(base, worktree), "--", ...code], root);
  const text = diff?.ok === true ? diff.stdout : "";
  const issues = [
    ...branchIssue(runtime, root),
    ...commitsIn(runtime, root, `${base}..HEAD`).flatMap((commit) =>
      closedByMessage(`${commit.subject}\n${commit.body}`),
    ),
  ];
  return {
    paths,
    symbols: symbolsInDiff(text),
    features: featuresInDiff(text, features),
    issues: [...new Set(issues)].sort((a, b) => a - b),
  };
};

export const staleMentions = (
  runtime: Pick<Runtime, "git" | "readText">,
  root: AbsolutePath,
  base: string,
  features: ReadonlySet<string>,
): readonly Mention[] => {
  const touched = touchedSince(runtime, root, base, features);
  const changed = new Set(changedFiles(runtime, root, base).filter((path) => path.endsWith(".md")));
  return mentionsOf(readUnits(runtime, root), touched, changed);
};
