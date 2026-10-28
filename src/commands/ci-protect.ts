import { type AppliedChange, applyChanges, PROTECT_LOG } from "../ci/protect/apply.js";
import { type CodeownersCoverage, codeownersCoverage } from "../ci/protect/coverage.js";
import { type ProtectChange, protectChanges } from "../ci/protect/plan.js";
import { readSettings, writeSettingsCache } from "../ci/protect/state.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { detectStack } from "../generate/stack.js";
import { projectAt } from "../install/project.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { gitLevel } from "../profile/level.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const CI_PROTECT_SCHEMA = "finitemonkey/ci-protect@1";
export const CI_PROTECT_FEATURE = "ci-protect";
const APPLY = "finitemonkey ci protect --yes";

export interface CiProtectData {
  readonly schema: typeof CI_PROTECT_SCHEMA;
  readonly repo: string;
  readonly level: string;
  readonly changes: readonly ProtectChange[];
  readonly applied: readonly AppliedChange[];
  readonly codeowners: CodeownersCoverage;
}

const changeLine = (ctx: Ctx, change: ProtectChange): string =>
  `  ${ctx.t("ci.protect.change", { setting: change.setting, current: change.current, proposed: change.proposed })}`;

const coverageLines = (ctx: Ctx, coverage: CodeownersCoverage): readonly string[] =>
  coverage.missing.length === 0
    ? []
    : [
        ctx.t("ci.protect.codeowners", {
          file: coverage.file ?? ".github/CODEOWNERS",
          paths: coverage.missing.join(", "),
        }),
      ];

const unavailable = (ctx: Ctx): CommandResult =>
  failureFrom(ctx.t, {
    code: "ci_protect_failed",
    messageKey: "ci.protect.unavailable",
    params: {},
    fix: "install gh, run gh auth login, and run this inside a clone of a GitHub repository",
    exitCode: ExitCode.NotConfigured,
  });

const applied = (ctx: Ctx, data: CiProtectData, human: readonly string[]): CommandResult<CiProtectData> => {
  const failed = data.applied.filter((change) => !change.ok);
  const lines = data.applied.map((change) =>
    ctx.t(change.ok ? "ci.protect.applied" : "ci.protect.not_applied", { setting: change.setting }),
  );
  if (failed.length === 0)
    return success(data, [...human, ...lines, ctx.t("ci.protect.recorded", { file: PROTECT_LOG })]);
  return failureFrom(
    ctx.t,
    {
      code: "ci_protect_failed",
      messageKey: "ci.protect.failed",
      params: { count: failed.length },
      fix: "check that your gh token can administer the repository, then run finitemonkey ci protect --yes again",
      exitCode: ExitCode.CheckFailed,
      data,
    },
    [...human, ...lines],
  );
};

const run = (ctx: Ctx): CommandResult => {
  const root = projectRoot(ctx);
  const paths = fmPaths(root);
  const mode = featureMode(ctx.runtime, paths, CI_PROTECT_FEATURE);
  if (mode === "off") return success({}, [ctx.t("gen.off", { feature: CI_PROTECT_FEATURE })]);
  const settings = readSettings(ctx.runtime, root);
  if (settings === undefined) return unavailable(ctx);
  writeSettingsCache(ctx.runtime, root, settings);
  const level = gitLevel(ctx.runtime, root);
  const project = projectAt(root, ctx.runtime);
  const codeowners = codeownersCoverage(project.read, detectStack(ctx.runtime, root).dirs);
  const changes = protectChanges(settings, level);
  const data: CiProtectData = {
    schema: CI_PROTECT_SCHEMA,
    repo: settings.repo,
    level,
    changes,
    applied: [],
    codeowners,
  };
  const human = [
    ctx.t("ci.protect.title", { repo: settings.repo, level }),
    ...changes.map((change) => changeLine(ctx, change)),
    ...coverageLines(ctx, codeowners),
  ];
  if (changes.length === 0) return success(data, [...human, ctx.t("ci.protect.nothing")]);
  if (!ctx.yes || ctx.dryRun) return { ...success(data, [...human, ctx.t("ci.protect.preview")]), next: APPLY };
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("ci.protect.needs_person", APPLY), human);
  if (mode === "shadow") {
    recordFeatureShadow(ctx.runtime, paths, CI_PROTECT_FEATURE, { changes: changes.map((change) => change.setting) });
    return success(data, [...human, ctx.t("gen.shadow", { feature: CI_PROTECT_FEATURE })]);
  }
  return applied(ctx, { ...data, applied: applyChanges(ctx.runtime, root, settings, level, changes) }, human);
};

export const ciProtectCommand: CommandSpec = {
  path: ["ci", "protect"],
  summaryKey: "ci.command.protect",
  usage: "finitemonkey ci protect [--yes]",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(run(ctx)),
};
