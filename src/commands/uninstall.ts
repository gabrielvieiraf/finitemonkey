import type { CommandArgs } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { readPreviousLock } from "../install/plan.js";
import { applyProblem, confirmProblem, notInstalled, openProject, planProblem } from "../install/session.js";
import { applyRemoval, planRemoval, type RemovalPlan } from "../install/uninstall.js";
import { removeCompiled } from "../rules/compile.js";
import { MANIFEST_FILE } from "../rules/manifest.js";
import type { CommandSpec } from "./types.js";

export const UNINSTALL_SCHEMA = "finitemonkey/uninstall-plan@1";

export interface UninstallData {
  readonly schema: typeof UNINSTALL_SCHEMA;
  readonly applied: boolean;
  readonly purge: boolean;
  readonly root: string;
  readonly actions: readonly { readonly path: string; readonly action: string }[];
  readonly kept: readonly string[];
  readonly outside: readonly string[];
}

const OUTSIDE = [
  { key: "install.uninstall.outside_plugin", command: "claude plugin uninstall finitemonkey@finitemonkey" },
  { key: "install.uninstall.outside_completion", command: "~/.bashrc, ~/.zshrc, $PROFILE" },
  { key: "install.uninstall.outside_ruleset", command: "gh api repos/{owner}/{repo}/rulesets" },
  {
    key: "install.uninstall.outside_refs",
    command: "git for-each-ref --format='delete %(refname)' refs/finitemonkey/ | git update-ref --stdin",
  },
] as const;

const dataOf = (root: string, plan: RemovalPlan, applied: boolean, rules: boolean): UninstallData => ({
  schema: UNINSTALL_SCHEMA,
  applied,
  purge: plan.purge,
  root,
  actions: [
    ...(rules ? [{ path: MANIFEST_FILE, action: "delete" }] : []),
    ...plan.items.map(({ path, action }) => ({ path, action })),
  ],
  kept: plan.items.filter((item) => item.action.startsWith("keep")).map(({ path }) => path),
  outside: OUTSIDE.map(({ command }) => command),
});

const linesOf = (ctx: Ctx, data: UninstallData): readonly string[] => [
  ctx.t("install.uninstall.title", { root: data.root }),
  ...data.actions.map(({ path, action }) => `  ${action.padEnd(15)}${path}`),
  ...(data.purge ? [ctx.t("install.uninstall.purge")] : [ctx.t("install.uninstall.keeps_state")]),
  ...data.kept.map((path) => ctx.t("install.warn.edited_kept", { path })),
  ctx.t("install.uninstall.outside"),
  ...OUTSIDE.map(({ key, command }) => `  ${ctx.t(key, { command })}`),
];

const fixFor = (args: CommandArgs): string =>
  [
    "finitemonkey uninstall --yes",
    ...(args.values["purge"] === true ? ["--purge"] : []),
    ...(args.values["keep-generated"] === true ? ["--keep-generated"] : []),
  ].join(" ");

const runUninstall = (ctx: Ctx, args: CommandArgs): CommandResult<UninstallData> => {
  const { project } = openProject(ctx);
  const lock = readPreviousLock(project);
  if (!lock.ok) return failureFrom(ctx.t, planProblem(lock.error));
  if (lock.value === undefined) return failureFrom(ctx.t, notInstalled());
  const options = { purge: args.values["purge"] === true, keepGenerated: args.values["keep-generated"] === true };
  const plan = planRemoval(project, lock.value, options);
  const preview = dataOf(project.root, plan, false, project.exists(MANIFEST_FILE));
  if (ctx.dryRun) return success(preview, [...linesOf(ctx, preview), ctx.t("install.dry_run")]);
  if (!ctx.yes) {
    const next = fixFor(args);
    const problem = confirmProblem("uninstall", ctx.t("install.uninstall.question"), next);
    return { ...failureFrom(ctx.t, { ...problem, data: preview }, linesOf(ctx, preview)), next };
  }
  const compiled = removeCompiled(ctx.runtime, project.root);
  if (!compiled.ok) return failureFrom(ctx.t, applyProblem({ path: MANIFEST_FILE, detail: compiled.error }));
  const removed = applyRemoval(project, planRemoval(project, lock.value, options));
  if (!removed.ok) return failureFrom(ctx.t, applyProblem(removed.error));
  const data = dataOf(project.root, plan, true, compiled.value.length > 0);
  return success(data, [...linesOf(ctx, data), ctx.t("install.uninstall.done")]);
};

export const uninstallCommand: CommandSpec = {
  path: ["uninstall"],
  summaryKey: "command.uninstall.summary",
  usage: "finitemonkey uninstall [--purge] [--keep-generated] [--dry-run] [--yes]",
  status: "ready",
  options: { purge: { type: "boolean" }, "keep-generated": { type: "boolean" } },
  run: (ctx, args) => Promise.resolve(runUninstall(ctx, args)),
};
