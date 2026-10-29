import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";

export interface CommitFact {
  readonly sha: string;
  readonly at: string;
  readonly author: string;
  readonly subject: string;
  readonly files: readonly string[];
}

const SEPARATOR = "\u001e";
const FIELD = "\u001f";

export const parseLog = (text: string): readonly CommitFact[] =>
  text
    .split(SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "")
    .flatMap((chunk) => {
      const [header = "", ...rest] = chunk.split("\n");
      const [sha, at, email, subject] = header.split(FIELD);
      if (sha === undefined || at === undefined || email === undefined || subject === undefined) return [];
      const files = rest.map((line) => line.trim()).filter((line) => line !== "");
      return [{ sha, at, author: sha256Hex(email.toLowerCase()).slice(0, 12), subject, files }];
    });

export const readCommits = (runtime: Pick<Runtime, "git">, root: AbsolutePath): readonly CommitFact[] => {
  const result = runtime.git(
    ["log", "--no-merges", "--reverse", `--format=${SEPARATOR}%H${FIELD}%cI${FIELD}%ae${FIELD}%s`, "--name-only"],
    root,
  );
  return result.ok ? parseLog(result.stdout) : [];
};

export const REVERT = /^(?:Revert "|revert(?:\([^)]*\))?!?:)/;
export const FIX = /^fix(?:\([^)]*\))?!?:/;
export const REWORK_DAYS = 14;
const DAY_MS = 86_400_000;

export const isRework = (commit: CommitFact, earlier: readonly CommitFact[]): boolean =>
  FIX.test(commit.subject) &&
  earlier.some(
    (prior) =>
      !FIX.test(prior.subject) &&
      Date.parse(commit.at) - Date.parse(prior.at) <= REWORK_DAYS * DAY_MS &&
      prior.files.some((file) => commit.files.includes(file)),
  );
