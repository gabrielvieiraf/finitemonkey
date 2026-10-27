import { basename, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { toPosixPath } from "../core/posix-path.js";

export const PLACE_PROBLEMS = ["temp", "nested", "slow"] as const;

export type PlaceProblem = (typeof PLACE_PROBLEMS)[number];

const MOUNTED = /^\/mnt\/[a-z]\//i;
const SYNCED = /(^|\/)(OneDrive[^/]*|Dropbox|Google ?Drive|My Drive|iCloud ?Drive|Mobile Documents)(\/|$)/i;
const FIXED_TEMP = ["/tmp", "/var/tmp"] as const;

const key = (path: string): string => toPosixPath(path).replace(/\/+$/, "");

export const isWithinPath = (parent: string, child: string): boolean => {
  const top = key(parent);
  const inner = key(child);
  return top !== "" && (inner === top || inner.startsWith(`${top}/`));
};

export const isSlowPlace = (path: string): boolean => MOUNTED.test(`${key(path)}/`) || SYNCED.test(key(path));

export const tempDirs = (env: Env): readonly string[] =>
  [...FIXED_TEMP, env["TMPDIR"], env["TEMP"], env["TMP"]].flatMap((dir) =>
    dir === undefined || dir === "" ? [] : [key(dir)],
  );

export interface PlaceContext {
  readonly mainRoot: string;
  readonly temps: readonly string[];
  readonly linked: readonly string[];
}

export const placeProblems = (path: string, context: PlaceContext): readonly PlaceProblem[] => {
  const problems: PlaceProblem[] = [];
  const temp = context.temps.find((dir) => isWithinPath(dir, path));
  if (temp !== undefined && !isWithinPath(temp, context.mainRoot)) problems.push("temp");
  if (context.linked.some((tree) => key(tree) !== key(path) && isWithinPath(tree, path))) problems.push("nested");
  if (isSlowPlace(path)) problems.push("slow");
  return problems;
};

export const OFFICIAL_DIR = ".claude/worktrees";

export const defaultPlace = (mainRoot: AbsolutePath, home: string, id: string): AbsolutePath =>
  isSlowPlace(mainRoot)
    ? toAbsolutePath(join(home, ".finitemonkey", "worktrees", basename(mainRoot), id))
    : toAbsolutePath(join(mainRoot, OFFICIAL_DIR, id));
