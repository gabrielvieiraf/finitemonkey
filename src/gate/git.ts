import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { ExecResult, Runtime } from "../core/runtime.js";
import { sha256Hex as sha256 } from "../secrets/fingerprint.js";
import { FM_DIR } from "../task/paths.js";

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const GIT_TIMEOUT_MS = 15000;
export const EXCLUDE_FM = `:(exclude)${FM_DIR}`;

export type ChangeStatus = "A" | "M" | "D" | "R";

export interface Change {
  readonly status: ChangeStatus;
  readonly path: string;
  readonly oldPath?: string;
}

export interface Git {
  readonly cwd: AbsolutePath;
  readonly run: (args: readonly string[]) => ExecResult;
  readonly out: (args: readonly string[]) => string | undefined;
}

export const gitAt = (runtime: Pick<Runtime, "exec">, cwd: AbsolutePath): Git => {
  const run = (args: readonly string[]): ExecResult =>
    runtime.exec({ command: "git", args: ["-c", "core.quotepath=off", ...args], cwd, timeoutMs: GIT_TIMEOUT_MS });
  return {
    cwd,
    run,
    out: (args) => {
      const result = run(args);
      return result.found && result.exitCode === 0 ? result.stdout : undefined;
    },
  };
};

export const gitRoot = (git: Git): AbsolutePath | undefined => {
  const top = git.out(["rev-parse", "--show-toplevel"])?.trim();
  return top === undefined || top === "" ? undefined : toAbsolutePath(top);
};

const nonEmpty = (value: string | undefined): string | undefined => (value === "" ? undefined : value);

export const headSha = (git: Git): string | undefined => git.out(["rev-parse", "--verify", "-q", "HEAD"])?.trim();

export const currentBranch = (git: Git): string | undefined => {
  const name = git.out(["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  return name === undefined || name === "HEAD" || name === "" ? undefined : name;
};

export const defaultRemoteBranch = (git: Git): string | undefined =>
  nonEmpty(git.out(["rev-parse", "--abbrev-ref", "origin/HEAD"])?.trim());

export const resolveBase = (git: Git, declared: string | undefined): string => {
  if (declared !== undefined && git.out(["rev-parse", "--verify", "-q", `${declared}^{commit}`]) !== undefined) {
    return declared;
  }
  const remote = defaultRemoteBranch(git);
  const merged = remote === undefined ? undefined : git.out(["merge-base", "HEAD", remote])?.trim();
  return nonEmpty(merged) ?? nonEmpty(headSha(git)) ?? EMPTY_TREE;
};

const nulFields = (text: string): readonly string[] => text.split("\0").filter((part) => part !== "");

export const untracked = (git: Git): readonly string[] =>
  nulFields(git.out(["ls-files", "--others", "--exclude-standard", "-z", "--", ".", EXCLUDE_FM]) ?? "");

const parseNameStatus = (text: string): readonly Change[] => {
  const fields = nulFields(text);
  const changes: Change[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const code = fields[index] ?? "";
    const letter = code.slice(0, 1);
    if (letter === "R" || letter === "C") {
      const oldPath = fields[index + 1] ?? "";
      const path = fields[index + 2] ?? "";
      changes.push(letter === "R" ? { status: "R", path, oldPath } : { status: "A", path });
      index += 2;
      continue;
    }
    const path = fields[index + 1] ?? "";
    changes.push({ status: letter === "D" ? "D" : letter === "A" ? "A" : "M", path });
    index += 1;
  }
  return changes;
};

export const changedFiles = (git: Git, base: string): readonly Change[] => {
  const tracked = parseNameStatus(
    git.out(["diff", "--name-status", "-M", "-z", "--no-color", base, "--", ".", EXCLUDE_FM]) ?? "",
  );
  const known = new Set(tracked.map((change) => change.path));
  const fresh = untracked(git)
    .filter((path) => !known.has(path))
    .map((path): Change => ({ status: "A", path }));
  return [...tracked, ...fresh];
};

export const fileAt = (git: Git, rev: string, path: string): string | undefined =>
  rev === EMPTY_TREE ? undefined : git.out(["show", `${rev}:${path}`]);

export const treeHash = (git: Git): string | undefined => {
  const head = headSha(git) ?? EMPTY_TREE;
  const diff = git.run(["diff", "HEAD", "--binary", "--no-ext-diff", "--no-color", "--", ".", EXCLUDE_FM]);
  if (!diff.found || (diff.exitCode !== 0 && head !== EMPTY_TREE)) return undefined;
  const files = untracked(git);
  const hashes = files.length === 0 ? "" : (git.out(["hash-object", "--", ...files]) ?? "");
  const digest = sha256([head, diff.stdout, files.join("\0"), hashes].join("\n--fm--\n"));
  return `w${digest.slice(0, 16)}`;
};

export interface AddedLine {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export const parseAddedLines = (diff: string): readonly AddedLine[] => {
  const added: AddedLine[] = [];
  let path = "";
  let line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) path = raw.slice(4).replace(/^b\//, "");
    else if (raw.startsWith("@@")) line = Number(HUNK.exec(raw)?.[1] ?? "0");
    else if (raw.startsWith("+")) {
      added.push({ path, line, text: raw.slice(1) });
      line += 1;
    } else if (!raw.startsWith("-") && !raw.startsWith("\\")) line += 1;
  }
  return added;
};

export const addedLines = (git: Git, base: string): readonly AddedLine[] =>
  parseAddedLines(git.out(["diff", "-U0", "--no-color", "--no-ext-diff", base, "--", ".", EXCLUDE_FM]) ?? "");

export interface NumStat {
  readonly files: number;
  readonly lines: number;
}

export const numstat = (git: Git, base: string): NumStat => {
  const rows = (git.out(["diff", "--numstat", "--no-color", base, "--", ".", EXCLUDE_FM]) ?? "")
    .split("\n")
    .filter((row) => row.trim() !== "");
  const lines = rows.reduce((sum, row) => {
    const [plus = "0", minus = "0"] = row.split("\t");
    return sum + (Number(plus) || 0) + (Number(minus) || 0);
  }, 0);
  return { files: rows.length, lines };
};

export const dirtyPaths = (git: Git): readonly string[] =>
  nulFields(git.out(["status", "--porcelain", "-z", "--", ".", EXCLUDE_FM]) ?? "").map((entry) => entry.slice(3));

export const aheadOfUpstream = (git: Git): number | undefined => {
  const count = git.out(["rev-list", "--count", "@{u}..HEAD"])?.trim();
  return count === undefined ? undefined : Number(count);
};
