import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { lineReader } from "../perfil/lines.js";
import { isPerson } from "../secrets/project.js";
import { applyGithubWrites, githubWritesOn, planGithubWrites } from "./github-write.js";
import type { FrontsState } from "./state.js";

export type GithubOutcome = "off" | "no-repo" | "nothing" | "no-person" | "declined" | "written";

export interface GithubStep {
  readonly outcome: GithubOutcome;
  readonly repo: string | null;
  readonly comments: number;
  readonly fields: number;
  readonly line: string | undefined;
}

const YES = /^(y|yes|s|sim|si|sí)$/i;

const step = (outcome: GithubOutcome, repo: string | null, line?: string, written = { comments: 0, fields: 0 }) => ({
  outcome,
  repo,
  ...written,
  line,
});

export const githubStep = async (
  ctx: Ctx,
  root: AbsolutePath,
  state: FrontsState,
  project: string | undefined,
  field: string,
): Promise<GithubStep> => {
  if (!githubWritesOn(ctx.runtime, root)) return step("off", null, ctx.t("fronts.github.off"));
  const plan = planGithubWrites(ctx.runtime, root, state, { project, field, t: ctx.t });
  if (plan === undefined) return step("no-repo", null, ctx.t("fronts.github.no_repo"));
  if (plan.comments.length === 0 && plan.fields.length === 0) return step("nothing", plan.repo);
  if (!isPerson(ctx)) return step("no-person", plan.repo, ctx.t("fronts.github.no_person"));
  const where =
    plan.project === undefined || plan.fields.length === 0
      ? ""
      : ctx.t("fronts.github.ask_project", { field: plan.project.field, project: plan.project.number });
  ctx.io.stderr.write(
    `${ctx.t("fronts.github.ask", { repo: plan.repo, count: plan.comments.length, project: where })}\n`,
  );
  const answer = (await lineReader(ctx.io.stdin)())?.trim() ?? "";
  if (!YES.test(answer)) return step("declined", plan.repo, ctx.t("fronts.github.declined", { repo: plan.repo }));
  const written = applyGithubWrites(ctx.runtime, root, plan);
  return step("written", plan.repo, ctx.t("fronts.github.done", { repo: plan.repo, ...written }), written);
};
