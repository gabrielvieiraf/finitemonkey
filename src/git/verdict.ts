export const GIT_BLOCK_RULES = [
  "force-push",
  "lease-not-own",
  "push-delete",
  "push-mirror",
  "clean",
  "stash-drop",
  "branch-unmerged",
  "worktree-force",
  "rm-worktree",
  "rm-root",
  "rebase-protected",
  "rebase-shared",
  "merge-side",
  "history",
  "protected-commit",
  "protected-push",
  "sql-destroy",
  "terraform-destroy",
  "kubectl-delete",
  "pipe-shell",
] as const;

export type GitBlockRule = (typeof GIT_BLOCK_RULES)[number];

export type DiscardScope = "tracked" | "worktree" | "all";

export interface DiscardSpec {
  readonly scope: DiscardScope;
  readonly pathspecs: readonly string[];
}

export type GitVerdict =
  | { readonly kind: "pass" }
  | { readonly kind: "snapshot"; readonly op: string }
  | { readonly kind: "discard"; readonly op: string; readonly discard: DiscardSpec }
  | { readonly kind: "block"; readonly rule: GitBlockRule; readonly subject: string };

export const PASS: GitVerdict = { kind: "pass" };

export const block = (rule: GitBlockRule, subject = ""): GitVerdict => ({ kind: "block", rule, subject });

export const snapshot = (op: string): GitVerdict => ({ kind: "snapshot", op });

export const discard = (op: string, scope: DiscardScope, pathspecs: readonly string[] = []): GitVerdict => ({
  kind: "discard",
  op,
  discard: { scope, pathspecs },
});

const SEVERITY: Readonly<Record<GitVerdict["kind"], number>> = { pass: 0, snapshot: 1, discard: 2, block: 3 };

export const worst = (verdicts: readonly GitVerdict[]): GitVerdict =>
  verdicts.reduce<GitVerdict>((current, next) => (SEVERITY[next.kind] > SEVERITY[current.kind] ? next : current), PASS);
