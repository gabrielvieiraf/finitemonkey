import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem } from "../core/problem.js";
import { type CommandResult, failureFrom } from "../core/result.js";
import { BYPASS_CACHE_FILE, type BypassProbe } from "../doctor/bypass-probe.js";
import { BYPASS_MAX_TURNS, BYPASS_RUN_DIR, INSTRUCTIONS_CAPTURE_FILE, runBypassProbe } from "../doctor/bypass-run.js";
import { ExitCode } from "../exit-codes.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";

export const BYPASS_PROBE_COMMAND = "finitemonkey doctor --probe bypass --yes";

const costLines = (ctx: Ctx, root: AbsolutePath): readonly string[] => {
  const paths = fmPaths(root);
  return [
    ctx.t("doctor.bypass.cost", { turns: BYPASS_MAX_TURNS }),
    ctx.t("doctor.bypass.writes", {
      dir: paths.cache(BYPASS_RUN_DIR),
      cache: paths.cache(BYPASS_CACHE_FILE),
      capture: paths.cache(INSTRUCTIONS_CAPTURE_FILE),
    }),
  ];
};

const ranLine = (ctx: Ctx, probe: BypassProbe, root: AbsolutePath): string =>
  ctx.t("doctor.bypass.ran", {
    version: probe.version,
    outcome: probe.outcome,
    count: probe.instructions,
    path: fmPaths(root).cache(INSTRUCTIONS_CAPTURE_FILE),
  });

export interface BypassRun {
  readonly ran: boolean;
  readonly probe?: BypassProbe;
}

export type BypassStep =
  | { readonly kind: "refused"; readonly result: CommandResult }
  | { readonly kind: "done"; readonly lines: readonly string[]; readonly run: BypassRun; readonly next?: string };

export const bypassStep = (ctx: Ctx, root: AbsolutePath): BypassStep => {
  if (!isPerson(ctx))
    return {
      kind: "refused",
      result: failureFrom(ctx.t, needsPersonProblem("doctor.bypass.person_only", BYPASS_PROBE_COMMAND)),
    };
  const cost = costLines(ctx, root);
  if (!ctx.yes || ctx.dryRun)
    return {
      kind: "done",
      lines: [...cost, ctx.t("doctor.bypass.confirm")],
      run: { ran: false },
      next: BYPASS_PROBE_COMMAND,
    };
  ctx.io.stderr.write(`${cost.join("\n")}\n`);
  const probe = runBypassProbe(ctx.runtime, fmPaths(root));
  if (probe === undefined)
    return {
      kind: "refused",
      result: failureFrom(ctx.t, {
        code: "doctor_failed",
        messageKey: "doctor.bypass.no_claude",
        params: {},
        fix: BYPASS_PROBE_COMMAND,
        exitCode: ExitCode.CheckFailed,
      }),
    };
  return { kind: "done", lines: [ranLine(ctx, probe, root)], run: { ran: true, probe } };
};
