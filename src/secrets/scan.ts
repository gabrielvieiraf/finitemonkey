import { join, relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { diffScanner } from "./diff.js";
import { scanText } from "./engine.js";
import { locate, type LocatedFinding } from "./located.js";

export const SCAN_MODES = ["path", "staged", "history"] as const;

export type ScanMode = (typeof SCAN_MODES)[number];

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SKIPPED = /(?:^|\/)(?:\.git|node_modules|\.finitemonkey)\//;

const DIFF_FLAGS = ["-U0", "--no-color", "--no-ext-diff", "--no-renames"] as const;

const binary = (text: string): boolean => text.slice(0, 8000).includes("\u0000");

const listed = (runtime: Runtime, root: AbsolutePath, target: string): Parsed<readonly string[]> => {
  const git = runtime.git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", target], root);
  if (git.ok)
    return accept(
      git.stdout
        .split("\u0000")
        .filter((name) => name !== "")
        .map(toPosixPath),
    );
  const base = toAbsolutePath(target, root);
  const walked = runtime.walkFiles(base);
  if (!walked.ok) return walked;
  return accept(walked.value.map((name) => toPosixPath(relative(root, join(base, toPosixPath(name))))));
};

export const scanFile = (runtime: Runtime, root: AbsolutePath, file: string): readonly LocatedFinding[] => {
  const text = runtime.readText(toAbsolutePath(file, root));
  if (!text.ok || text.value.length > MAX_FILE_BYTES || binary(text.value)) return [];
  return scanText(text.value, { path: file }).map((finding) => locate(finding, file, finding.line));
};

export const scanPath = (runtime: Runtime, root: AbsolutePath, target: string): Parsed<readonly LocatedFinding[]> => {
  const files = listed(runtime, root, target);
  if (!files.ok) return files;
  return accept(files.value.filter((file) => !SKIPPED.test(file)).flatMap((file) => scanFile(runtime, root, file)));
};

export const diffFindings = (diff: string): readonly LocatedFinding[] => {
  const scanner = diffScanner();
  for (const line of diff.split("\n")) scanner.push(line);
  return scanner.end().filter((finding) => !SKIPPED.test(finding.file));
};

export const scanStaged = (
  runtime: Runtime,
  root: AbsolutePath,
  includeUnstaged = false,
): Parsed<readonly LocatedFinding[]> => {
  const args = includeUnstaged ? ["diff", "HEAD", ...DIFF_FLAGS] : ["diff", "--cached", ...DIFF_FLAGS];
  const git = runtime.git(args, root);
  if (!git.ok) return reject(git.found ? "git diff failed" : "git not found");
  return accept(diffFindings(git.stdout));
};

export const scanHistory = async (runtime: Runtime, root: AbsolutePath): Promise<Parsed<readonly LocatedFinding[]>> => {
  const scanner = diffScanner();
  const args = ["log", "-p", "--all", "--format=commit %H", ...DIFF_FLAGS];
  const git = await runtime.gitLines(args, root, scanner.push);
  if (!git.ok) return reject(git.found ? "git log failed" : "git not found");
  return accept(scanner.end().filter((finding) => !SKIPPED.test(finding.file)));
};
