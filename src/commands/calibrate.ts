import { stateLine } from "../calibrate/hooks.js";
import { CALIBRATE_INPUTS } from "../calibrate/inputs.js";
import { computeCalibration, refitCalibration } from "../calibrate/refit.js";
import type { Ctx } from "../core/context.js";
import { success } from "../core/result.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import type { CommandSpec } from "./types.js";

export const CALIBRATE_SCHEMA = "finitemonkey/calibrate@1";

const pathsOf = (ctx: Ctx): ReturnType<typeof fmPaths> => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

export const calibrateRefitCommand: CommandSpec = {
  path: ["calibrate", "refit"],
  summaryKey: "command.calibrate_refit.summary",
  usage: "finitemonkey calibrate refit [--json]",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const calibration = refitCalibration(ctx.runtime, pathsOf(ctx));
    return Promise.resolve(
      success({ schema: CALIBRATE_SCHEMA, ...calibration }, [
        ctx.t("calibrate.refit", {
          labels: calibration.labels,
          bad: calibration.bad,
          min: calibration.minLabels,
          by: calibration.model === undefined ? "rules" : "model",
        }),
      ]),
    );
  },
};

const round = (value: number): string => value.toFixed(2);

export const calibrateExplainCommand: CommandSpec = {
  path: ["calibrate", "explain"],
  summaryKey: "command.calibrate_explain.summary",
  usage: "finitemonkey calibrate explain [<task>] [--json]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const paths = pathsOf(ctx);
    const task = args.positionals[0] ?? readState(ctx.runtime, paths).active;
    const calibration = computeCalibration(ctx.runtime, paths);
    const decision = task === undefined ? undefined : calibration.decisions[task];
    const { model } = calibration;
    const lines =
      task === undefined || decision === undefined
        ? [ctx.t("calibrate.explain.none")]
        : [
            stateLine(ctx.t, task, decision),
            ctx.t("calibrate.explain.labels", {
              labels: calibration.labels,
              bad: calibration.bad,
              min: calibration.minLabels,
            }),
            ...CALIBRATE_INPUTS.map((name, index) =>
              ctx.t("calibrate.explain.input", {
                name,
                value: round(decision.inputs[name]),
                weight: model === undefined ? "-" : round(model.weights[index] ?? 0),
              }),
            ),
          ];
    return Promise.resolve(
      success(
        {
          schema: CALIBRATE_SCHEMA,
          task: task ?? null,
          labels: calibration.labels,
          bad: calibration.bad,
          minLabels: calibration.minLabels,
          inputs: [...CALIBRATE_INPUTS],
          decision: decision === undefined ? null : { ...decision },
          model: model === undefined ? null : { ...model },
        },
        lines,
      ),
    );
  },
};
