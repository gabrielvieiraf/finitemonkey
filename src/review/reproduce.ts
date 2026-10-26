import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { Finding } from "./findings.js";

export const REVIEW_LEDGER = ".finitemonkey/review/ledger.jsonl";
export const REPRO_TIMEOUT_MS = 120_000;

export const OUTCOMES = ["head-only", "already-there", "not-reproduced", "not-run"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface ReproRun {
  readonly finding: number;
  readonly rev: string;
  readonly side: "base" | "head";
  readonly command: string;
  readonly exitCode: number | null;
  readonly at: string;
}

export interface Checked {
  readonly finding: Finding;
  readonly base?: ReproRun;
  readonly head?: ReproRun;
  readonly outcome: Outcome;
}

const fails = (run: ReproRun | undefined): boolean => run !== undefined && run.exitCode !== 0;

export const outcomeOf = (base: ReproRun | undefined, head: ReproRun | undefined): Outcome => {
  if (base === undefined || head === undefined || head.exitCode === null || base.exitCode === null) return "not-run";
  if (fails(head) && !fails(base)) return "head-only";
  return fails(head) && fails(base) ? "already-there" : "not-reproduced";
};

const worktreeDir = (root: AbsolutePath, side: string): AbsolutePath =>
  toAbsolutePath(join(root, ".finitemonkey", "review", `worktree-${side}`));

export interface Sides {
  readonly base: string;
  readonly head: string;
}

const runAt = (
  runtime: Runtime,
  root: AbsolutePath,
  side: "base" | "head",
  rev: string,
  findings: readonly Finding[],
): readonly ReproRun[] => {
  const dir = worktreeDir(root, side);
  runtime.git(["worktree", "remove", "--force", dir], root);
  const added = runtime.git(["worktree", "add", "--detach", "--force", dir, rev], root);
  if (!added.ok) return [];
  try {
    return findings.flatMap((finding) => {
      if (finding.repro === undefined) return [];
      const result = runtime.exec({
        command: finding.repro.command,
        args: [],
        cwd: dir,
        timeoutMs: REPRO_TIMEOUT_MS,
        shell: true,
      });
      const exitCode = result.found && !result.timedOut ? result.exitCode : null;
      return [{ finding: finding.id, rev, side, command: finding.repro.command, exitCode, at: runtime.now() }];
    });
  } finally {
    runtime.git(["worktree", "remove", "--force", dir], root);
  }
};

export const reproduce = (
  runtime: Runtime,
  root: AbsolutePath,
  sides: Sides,
  findings: readonly Finding[],
): readonly Checked[] => {
  const musts = findings.filter((finding) => finding.group === "must");
  const runs = [...runAt(runtime, root, "base", sides.base, musts), ...runAt(runtime, root, "head", sides.head, musts)];
  if (runs.length > 0) {
    runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey", "review")));
    runtime.appendText(
      toAbsolutePath(join(root, REVIEW_LEDGER)),
      runs.map((run) => `${JSON.stringify(run)}\n`).join(""),
    );
  }
  return findings.map((finding) => {
    if (finding.group !== "must") return { finding, outcome: "not-run" };
    const base = runs.find((run) => run.finding === finding.id && run.side === "base");
    const head = runs.find((run) => run.finding === finding.id && run.side === "head");
    return {
      finding,
      ...(base === undefined ? {} : { base }),
      ...(head === undefined ? {} : { head }),
      outcome: outcomeOf(base, head),
    };
  });
};

export interface Settled {
  readonly finding: Finding;
  readonly group: Finding["group"] | "already-there" | "not-reproduced";
  readonly decisionNeeded: boolean;
}

export const settle = (item: Checked): Settled => {
  const { finding, outcome } = item;
  if (finding.group !== "must" || outcome === "head-only" || outcome === "not-run")
    return { finding, group: finding.group, decisionNeeded: false };
  if (outcome === "already-there") return { finding, group: "already-there", decisionNeeded: finding.activeRisk };
  return { finding, group: "not-reproduced", decisionNeeded: false };
};
