import type { AbsolutePath } from "../core/brand.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";
import { readFront, textList } from "../plan/front.js";
import { linesOf, pathspecOf } from "./grep.js";
import { reposOf } from "./report.js";
import { INVENTORY_SCHEMA } from "./types.js";

export type ReportState =
  | { readonly kind: "fresh"; readonly report: string }
  | {
      readonly kind: "expired";
      readonly report: string;
      readonly topic: string;
      readonly hash: string;
      readonly changed: readonly string[];
    }
  | { readonly kind: "unknown"; readonly report: string; readonly repo: string; readonly hash: string };

const TODAY = /^\d{2,}[a-z]?-today-.+\.md$/;

const changedSince = (
  runtime: Runtime,
  dir: AbsolutePath,
  hash: string,
  covered: readonly string[],
): readonly string[] | undefined => {
  const git = gitAt(runtime, dir);
  if (git.out(["cat-file", "-e", `${hash}^{commit}`]) === undefined) return undefined;
  const spec = pathspecOf(covered);
  const tracked = linesOf(git.out(["diff", "--name-only", hash, "--", ...spec]));
  const untracked = linesOf(git.out(["ls-files", "--others", "--exclude-standard", "--", ...spec]));
  return [...new Set([...tracked, ...untracked])].sort();
};

const stateOf = (runtime: Runtime, root: AbsolutePath, name: string): ReportState | undefined => {
  const text = runtime.readText(planPath(root, name));
  const front = text.ok ? readFront(text.value).data : undefined;
  if (front?.["schema"] !== INVENTORY_SCHEMA) return undefined;
  const report = `${PLAN_DIR}/${name}`;
  const topic = typeof front["topic"] === "string" ? front["topic"] : name;
  const covered = textList(front, "covered");
  for (const repo of reposOf(front)) {
    const changed = changedSince(runtime, toAbsolutePath(repo.path, root), repo.hash, covered);
    if (changed === undefined) return { kind: "unknown", report, repo: repo.path, hash: repo.hash };
    if (changed.length > 0) return { kind: "expired", report, topic, hash: repo.hash, changed };
  }
  return { kind: "fresh", report };
};

export const inventoryStates = (runtime: Runtime, root: AbsolutePath): readonly ReportState[] =>
  planFiles(runtime, root)
    .filter((name) => TODAY.test(name))
    .flatMap((name) => stateOf(runtime, root, name) ?? []);
