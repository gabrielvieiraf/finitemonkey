import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { projectPreset } from "./preset.js";
import { isFlagged, scoreProse } from "./score.js";
import type { ProseContext, ProseReport } from "./types.js";

export interface ProseFileReport {
  readonly file: string;
  readonly report: ProseReport;
}

export interface ProseGateStatus {
  readonly files: readonly ProseFileReport[];
  readonly flagged: readonly ProseFileReport[];
  readonly blocking: boolean;
}

const MARKDOWN = /\.(?:md|markdown|mdx)$/i;
const RECORD_FILE = /(?:^|\/)(?:CHANGELOG|RELEASE[-_]?NOTES|HISTORY)[^/]*$/i;

export const contextOf = (file: string): ProseContext => (RECORD_FILE.test(toPosixPath(file)) ? "record" : "docs");

const listed = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): Parsed<readonly string[]> => {
  const result = runtime.git(args, root);
  if (!result.ok) return reject(`git ${args.join(" ")} failed`);
  return accept(result.stdout.split("\u0000").map(toPosixPath));
};

export const changedMarkdown = (runtime: Runtime, root: AbsolutePath): Parsed<readonly string[]> => {
  const tracked = listed(runtime, root, ["diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD"]);
  if (!tracked.ok) return tracked;
  const untracked = listed(runtime, root, ["ls-files", "-z", "--others", "--exclude-standard"]);
  if (!untracked.ok) return untracked;
  const files = [...tracked.value, ...untracked.value].filter(
    (file) => MARKDOWN.test(file) && !file.startsWith(".finitemonkey/"),
  );
  return accept([...new Set(files)].sort());
};

export const scoreFiles = (
  runtime: Runtime,
  root: AbsolutePath,
  files: readonly string[],
  forced?: ProseContext,
): Parsed<readonly ProseFileReport[]> => {
  const reports: ProseFileReport[] = [];
  for (const file of files) {
    const text = runtime.readText(toAbsolutePath(file, root));
    if (!text.ok) return reject(`${file}: ${text.error}`);
    reports.push({ file: toPosixPath(file), report: scoreProse(text.value, { context: forced ?? contextOf(file) }) });
  }
  return accept(reports);
};

export const proseGateStatus = (runtime: Runtime, root: AbsolutePath): Parsed<ProseGateStatus> => {
  const changed = changedMarkdown(runtime, root);
  if (!changed.ok) return changed;
  const files = scoreFiles(runtime, root, changed.value);
  if (!files.ok) return files;
  return accept({
    files: files.value,
    flagged: files.value.filter((item) => isFlagged(item.report)),
    blocking: projectPreset(runtime, root) === "gabriel",
  });
};
