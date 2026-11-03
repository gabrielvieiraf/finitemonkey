import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { success } from "../core/result.js";
import { judgeLines } from "../judge/lines.js";
import { response } from "../judge/response.js";
import { proposeContradictions } from "../judge/verbs-events.js";
import { proposeHelps } from "../judge/verbs-horizon.js";
import { inGuardianRepo } from "./guardian.js";
import { refuse, switchedOff } from "./judge.js";
import { judgeDeps } from "./judge-deps.js";
import type { CommandSpec } from "./types.js";

const HORIZON_USAGE =
  'finitemonkey judge horizon propose --text "<what you are about to judge>" --domain <id> [--task <id>]';
const CONTRADICT_USAGE = "finitemonkey judge contradict propose <claim>";

export const judgeHorizonProposeCommand: CommandSpec = {
  path: ["judge", "horizon", "propose"],
  summaryKey: "command.judge_horizon_propose.summary",
  usage: HORIZON_USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { text: { type: "string" }, domain: { type: "string" }, task: { type: "string" } },
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const text = stringOption(args.values, "text");
      const domain = stringOption(args.values, "domain");
      if (text === undefined || domain === undefined) return refuse(ctx, "judge.error.usage", HORIZON_USAGE);
      const off = switchedOff(ctx, root, { verb: "horizon" });
      if (off !== undefined) return off;
      const deps = judgeDeps(ctx, root);
      const task = stringOption(args.values, "task");
      const data = proposeHelps(deps, { text, domain, ...(task === undefined ? {} : { task }) }, deps.horizon);
      const lines = judgeLines(ctx.t, data);
      return success(data, lines.length === 0 ? [ctx.t("judge.horizon.none_proposed")] : lines);
    }),
};

const contradictionLines = (ctx: Ctx, claim: string, found: readonly { source: string; span: string }[]) =>
  found.length === 0
    ? [ctx.t("judge.contradict.none_proposed", { claim })]
    : [
        ...found.map((item) => ctx.t("judge.contradict.proposed", { claim, source: item.source, span: item.span })),
        ctx.t("judge.contradict.proposed_hint", { claim }),
      ];

export const judgeContradictProposeCommand: CommandSpec = {
  path: ["judge", "contradict", "propose"],
  summaryKey: "command.judge_contradict_propose.summary",
  usage: CONTRADICT_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const claim = args.positionals[0];
      if (claim === undefined) return refuse(ctx, "judge.error.usage", CONTRADICT_USAGE);
      const off = switchedOff(ctx, root, { verb: "contradict" });
      if (off !== undefined) return off;
      const deps = judgeDeps(ctx, root);
      const found = proposeContradictions(deps, claim, deps.contradictions);
      const data = response("contradict", {
        proposedContradictions: found.map((item) => ({ ...item, origin: "model-proposed" as const })),
      });
      return success(data, contradictionLines(ctx, claim, found));
    }),
};
