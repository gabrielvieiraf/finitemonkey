import type { Ctx } from "../core/context.js";
import { lineReader } from "../perfil/lines.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import { detectCommitStyle, type DetectedCommits } from "./detect.js";
import { COMMIT_STYLES, type CommitStyle, type ProjectDefaults, projectDefaults } from "./items.js";

const NO = new Set(["n", "no", "não", "nao"]);

export type CommitsAnswer =
  | { readonly kind: "given"; readonly style: CommitStyle }
  | { readonly kind: "pending"; readonly detected: DetectedCommits }
  | { readonly kind: "none" };

export const parseCommitStyle = (raw: string | undefined): CommitStyle | undefined =>
  COMMIT_STYLES.find((style) => style === raw);

export const commitsAnswer = async (ctx: Ctx, flag: CommitStyle | undefined): Promise<CommitsAnswer> => {
  if (flag !== undefined) return { kind: "given", style: flag };
  const root = projectRoot(ctx);
  if (projectDefaults(ctx.runtime, root).commits !== undefined) return { kind: "none" };
  const detected = detectCommitStyle(ctx.runtime, root);
  if (detected?.style !== "free") return { kind: "none" };
  if (!isPerson(ctx)) return { kind: "pending", detected };
  ctx.io.stderr.write(`${ctx.t("defaults.question.commits", { ...detected })} `);
  const answer = (await lineReader(ctx.io.stdin)())?.trim().toLowerCase() ?? "";
  return { kind: "given", style: NO.has(answer) ? "free" : "conventional" };
};

export const withCommits = (defaults: ProjectDefaults, answer: CommitsAnswer): ProjectDefaults => {
  if (answer.kind !== "given") return defaults;
  const off = defaults.off.filter((item) => item !== "conventional-commits");
  return {
    off: answer.style === "free" ? [...off, "conventional-commits"] : off,
    commits: answer.style,
  };
};
