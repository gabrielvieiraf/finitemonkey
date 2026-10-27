import { withoutCarriageReturn } from "../core/posix-path.js";
import type { Git } from "../gate/git.js";
import { type GrepPattern, SKIPPED } from "./patterns.js";
import type { Hit } from "./types.js";

const GREP_LINE = /^[^:]+:(.+?):(\d+):(.*)$/;

export const pathspecOf = (covered: readonly string[]): readonly string[] => [
  ...(covered.length === 0 ? ["."] : covered),
  ...SKIPPED,
];

export const linesOf = (text: string | undefined): readonly string[] =>
  (text ?? "")
    .split("\n")
    .map(withoutCarriageReturn)
    .filter((line) => line !== "");

export const grepAt = (git: Git, hash: string, grep: GrepPattern, covered: readonly string[]): readonly Hit[] => {
  const flags = grep.ignoreCase === true ? ["-i"] : [];
  const out = git.out(["grep", "-n", "-I", "-E", ...flags, "-e", grep.pattern, hash, "--", ...pathspecOf(covered)]);
  return linesOf(out).flatMap((line) => {
    const match = GREP_LINE.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) return [];
    return [{ file: match[1], line: Number.parseInt(match[2], 10), text: (match[3] ?? "").trim() }];
  });
};

const SKIPPED_FILE =
  /(^|\/)(node_modules|dist|build|vendor)\/|\.min\.js$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|^docs\/plan\/|^\.finitemonkey\//;

const insideAny = (file: string, covered: readonly string[]): boolean =>
  covered.length === 0 ||
  covered.some((dir) => {
    const prefix = dir.replace(/\/+$/, "");
    return prefix === "." || prefix === "" || file === prefix || file.startsWith(`${prefix}/`);
  });

export const filesAt = (git: Git, hash: string, covered: readonly string[]): readonly string[] =>
  linesOf(git.out(["ls-tree", "-r", "--name-only", hash])).filter(
    (file) => insideAny(file, covered) && !SKIPPED_FILE.test(file),
  );

export const showAt = (git: Git, hash: string, file: string): string | undefined =>
  git.out(["show", `${hash}:${file}`]);

export const resolveCommit = (git: Git, ref: string): string | undefined => {
  const hash = git.out(["rev-parse", "--verify", "-q", `${ref}^{commit}`])?.trim();
  return hash === undefined || hash === "" ? undefined : hash;
};
