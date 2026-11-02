import type { Ctx } from "../core/context.js";
import { projectAt } from "../install/project.js";
import type { AskLine } from "../perfil/lines.js";
import { featureMode } from "../policy/feature.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { CONVENTION_IDS, CONVENTION_OFF, type ConventionId, type Conventions } from "./conventions.js";
import { detectConventions, type DetectedConvention } from "./detect-conventions.js";
import { type ProjectDefaults, projectDefaults } from "./items.js";

export const DEFAULTS_ADAPT_FEATURE = "defaults-adapt";

const NO = new Set(["n", "no", "não", "nao"]);

export type ConventionAnswer =
  | { readonly kind: "given"; readonly id: ConventionId; readonly value: string }
  | { readonly kind: "pending"; readonly detected: DetectedConvention }
  | { readonly kind: "shadow"; readonly detected: DetectedConvention };

const askOne = async (ctx: Ctx, ask: AskLine, detected: DetectedConvention): Promise<ConventionAnswer> => {
  ctx.io.stderr.write(`${ctx.t(`defaults.question.${detected.id}`, { ...detected })} `);
  const answer = (await ask())?.trim().toLowerCase() ?? "";
  return { kind: "given", id: detected.id, value: NO.has(answer) ? CONVENTION_OFF : detected.value };
};

export const conventionAnswers = async (
  ctx: Ctx,
  flags: Conventions,
  ask: () => AskLine,
): Promise<readonly ConventionAnswer[]> => {
  const root = projectRoot(ctx);
  const known = projectDefaults(ctx.runtime, root).conventions ?? {};
  const detected = detectConventions(projectAt(root, ctx.runtime));
  const mode = featureMode(ctx.runtime, fmPaths(root), DEFAULTS_ADAPT_FEATURE);
  const answers: ConventionAnswer[] = [];
  for (const id of CONVENTION_IDS) {
    const flag = flags[id];
    const found = detected.find((item) => item.id === id);
    if (flag !== undefined) answers.push({ kind: "given", id, value: flag });
    else if (known[id] !== undefined || found === undefined || mode === "off") continue;
    else if (mode === "shadow") answers.push({ kind: "shadow", detected: found });
    else if (!isPerson(ctx)) answers.push({ kind: "pending", detected: found });
    else answers.push(await askOne(ctx, ask(), found));
  }
  return answers;
};

export const withConventions = (defaults: ProjectDefaults, answers: readonly ConventionAnswer[]): ProjectDefaults => {
  const given = answers.flatMap((answer) => (answer.kind === "given" ? [[answer.id, answer.value] as const] : []));
  if (given.length === 0) return defaults;
  return { ...defaults, conventions: { ...defaults.conventions, ...Object.fromEntries(given) } };
};
