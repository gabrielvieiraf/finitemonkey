import { stringOption } from "../core/args.js";
import { isPerson } from "../secrets/project.js";
import { judgeCommand } from "./judge.js";
import type { CommandSpec } from "./types.js";

export const judgeDependCommand = judgeCommand({
  path: ["judge", "depend"],
  summaryKey: "command.judge_depend.summary",
  usage: "finitemonkey judge depend <claim> --on <claim>",
  options: { on: { type: "string" } },
  maxPositionals: 1,
  build: (_ctx, values, positionals) => ({ verb: "depend", claim: positionals[0], on: stringOption(values, "on") }),
});

export const judgeRetractCommand = judgeCommand({
  path: ["judge", "retract"],
  summaryKey: "command.judge_retract.summary",
  usage: "finitemonkey judge retract <claim>",
  maxPositionals: 1,
  person: true,
  build: (_ctx, _values, positionals) => ({ verb: "retract", claim: positionals[0] }),
});

export const judgeFailedCommand = judgeCommand({
  path: ["judge", "failed"],
  summaryKey: "command.judge_failed.summary",
  usage: "finitemonkey judge failed <claim>",
  maxPositionals: 1,
  build: (_ctx, _values, positionals) => ({ verb: "failed", claim: positionals[0] }),
});

export const judgeContradictCommand = judgeCommand({
  path: ["judge", "contradict"],
  summaryKey: "command.judge_contradict.summary",
  usage: 'finitemonkey judge contradict <claim> --source <doi|url|file> --span "<text>" [--scope] [--confirm]',
  options: {
    source: { type: "string" },
    span: { type: "string" },
    scope: { type: "boolean" },
    confirm: { type: "boolean" },
  },
  maxPositionals: 1,
  build: (ctx, values, positionals) => ({
    verb: "contradict",
    claim: positionals[0],
    source: stringOption(values, "source"),
    span: stringOption(values, "span"),
    scope: values["scope"] === true,
    confirmed: values["confirm"] === true && isPerson(ctx),
  }),
});

export const judgeFixedCommand = judgeCommand({
  path: ["judge", "fixed"],
  summaryKey: "command.judge_fixed.summary",
  usage: "finitemonkey judge fixed <event> --by person|agent|revert",
  options: { by: { type: "string" } },
  maxPositionals: 1,
  build: (ctx, values, positionals) => {
    const by = stringOption(values, "by");
    return by === "person" && !isPerson(ctx) ? undefined : { verb: "fixed", event: positionals[0], by };
  },
});

export const judgeTrajectoryCommand = judgeCommand({
  path: ["judge", "trajectory"],
  summaryKey: "command.judge_trajectory.summary",
  usage: "finitemonkey judge trajectory",
  build: () => ({ verb: "trajectory" }),
});

export const JUDGE_EVENT_COMMANDS: readonly CommandSpec[] = [
  judgeDependCommand,
  judgeRetractCommand,
  judgeFailedCommand,
  judgeContradictCommand,
  judgeFixedCommand,
  judgeTrajectoryCommand,
];
