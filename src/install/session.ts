import type { Ctx } from "../core/context.js";
import type { Problem } from "../core/problem.js";
import { ExitCode } from "../exit-codes.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { CLAUDE_LANGUAGE, type LangSource } from "../i18n/languages.js";
import type { Params } from "../i18n/translate.js";
import type { ApplyFailure } from "./apply.js";
import type { Preset } from "./layout.js";
import type { PlanError, PlanInput } from "./plan.js";
import { findGitRoot, type Project, projectAt } from "./project.js";
import { isBundlePath } from "./vendor.js";

export interface Opened {
  readonly project: Project;
  readonly gitRoot: boolean;
}

export const openProject = (ctx: Ctx): Opened => {
  const root = findGitRoot(ctx.cwd, ctx.runtime);
  return { project: projectAt(root ?? ctx.cwd, ctx.runtime), gitRoot: root !== undefined };
};

const problem = (
  code: Problem["code"],
  messageKey: MessageKey,
  fix: string,
  exitCode: Problem["exitCode"],
  params: Params,
): Problem => ({
  code,
  messageKey,
  params,
  fix,
  exitCode,
});

export const planProblem = (error: PlanError): Problem => {
  if (error.kind === "bundle") {
    return problem("install_failed", "error.install_failed", "npx finitemonkey@latest init", ExitCode.NotConfigured, {
      path: ".finitemonkey/runtime/dist/finitemonkey.mjs",
      detail: error.detail,
    });
  }
  return error.kind === "settings"
    ? problem(
        "settings_unreadable",
        "error.settings_unreadable",
        "fix the JSON in .claude/settings.json, then run finitemonkey init again",
        ExitCode.NotConfigured,
        { detail: error.detail },
      )
    : problem(
        "lock_unreadable",
        "error.lock_unreadable",
        "finitemonkey uninstall --purge --yes",
        ExitCode.NotConfigured,
        { detail: error.detail },
      );
};

export const applyProblem = (failure: ApplyFailure): Problem =>
  failure.detail.startsWith("locked:")
    ? problem(
        "install_locked",
        "error.install_locked",
        "wait for the other finitemonkey run to finish, then try again",
        ExitCode.CheckFailed,
        { path: failure.path },
      )
    : problem("install_failed", "error.install_failed", "finitemonkey doctor", ExitCode.NotConfigured, {
        path: failure.path,
        detail: failure.detail,
      });

export const notInstalled = (): Problem =>
  problem("not_installed", "error.not_installed", "finitemonkey init", ExitCode.NotConfigured, {});

export const confirmProblem = (command: string, question: string, fix: string): Problem =>
  problem("needs_confirmation", "error.needs_confirmation", fix, ExitCode.NeedsPerson, { command, question });

export const invalidPreset = (raw: string): Problem =>
  problem("invalid_arguments", "error.invalid_preset", "finitemonkey init --preset neutral", ExitCode.Usage, {
    preset: raw,
  });

const selfBundle = (ctx: Ctx): string | undefined => {
  if (!isBundlePath(ctx.runtime.selfPath)) return undefined;
  const text = ctx.runtime.readText(ctx.runtime.selfPath);
  return text.ok ? text.value : undefined;
};

const INHERITED: ReadonlySet<LangSource> = new Set(["default", "config", "claude-settings"]);

export const planInputFor = (ctx: Ctx, preset: Preset, bin: string | undefined, marketplace: boolean): PlanInput => ({
  preset,
  lang: ctx.lang,
  claudeLanguage: INHERITED.has(ctx.langSource) ? undefined : CLAUDE_LANGUAGE[ctx.lang],
  bin,
  version: ctx.version,
  marketplace,
  bundle: selfBundle(ctx),
  env: ctx.env,
  t: ctx.t,
});
