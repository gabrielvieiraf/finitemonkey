import type { Git } from "../gate/git.js";

export const CHURN_DAYS = 90;
const DAY_S = 86_400;
const FIX_SUBJECT = /^(?:fix|bugfix|hotfix)(?:\(|!|:)|\b(?:fix|fixes|fixed|bug)\b/i;
const MARK = "\u0001";

export interface FileHistory {
  readonly churn: number;
  readonly fixes: number;
}

export interface History {
  readonly head: string;
  readonly files: ReadonlyMap<string, FileHistory>;
}

const headInfo = (git: Git): { readonly sha: string; readonly time: number } | undefined => {
  const [sha = "", time = ""] = (git.out(["log", "-1", "--format=%H %ct", "HEAD"]) ?? "").trim().split(" ");
  const seconds = Number(time);
  return sha === "" || !Number.isFinite(seconds) ? undefined : { sha, time: seconds };
};

export const readHistory = (git: Git): History | undefined => {
  const head = headInfo(git);
  if (head === undefined) return undefined;
  const since = head.time - CHURN_DAYS * DAY_S;
  const raw = git.out(["log", "HEAD", `--since=${String(since)}`, "--no-merges", "--name-only", `--format=${MARK}%s`]);
  const files = new Map<string, FileHistory>();
  for (const block of (raw ?? "").split(MARK).filter((part) => part.trim() !== "")) {
    const [subject = "", ...paths] = block.split("\n");
    const fix = FIX_SUBJECT.test(subject) ? 1 : 0;
    for (const path of new Set(paths.map((line) => line.trim()).filter((line) => line !== ""))) {
      const prior = files.get(path) ?? { churn: 0, fixes: 0 };
      files.set(path, { churn: prior.churn + 1, fixes: prior.fixes + fix });
    }
  }
  return { head: head.sha, files };
};
