import { usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { park, type ParkedIdea, readParking, unpark } from "../focus/parking.js";
import type { Translate } from "../i18n/translate.js";
import { fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { guardianWriteProblem, inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const PARKING_SCHEMA = "finitemonkey/parking@1";

const PARK_USAGE = 'finitemonkey park "<idea>" | finitemonkey park --list';
const UNPARK_USAGE = "finitemonkey unpark <id>";

const ideaLine = (t: Translate, idea: ParkedIdea): string =>
  t("focus.park.line", { id: idea.id, text: idea.text, task: idea.task ?? "-" });

export const parkCommand: CommandSpec = {
  path: ["park"],
  summaryKey: "command.park.summary",
  usage: PARK_USAGE,
  status: "ready",
  maxPositionals: 50,
  options: { list: { type: "boolean" } },
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const text = args.positionals.join(" ").trim();
      if (args.values["list"] === true || text === "") {
        const parked = readParking(ctx.runtime, paths).filter((idea) => idea.status === "parked");
        const lines = parked.map((idea) => ideaLine(ctx.t, idea));
        return success(
          { schema: PARKING_SCHEMA, ideas: parked },
          lines.length === 0 ? [ctx.t("focus.park.empty")] : lines,
        );
      }
      const idea = park(ctx.runtime, paths, readState(ctx.runtime, paths).active, text);
      if (idea === undefined) return failureFrom(ctx.t, guardianWriteProblem(".finitemonkey/parking.jsonl"));
      return success({ schema: PARKING_SCHEMA, ideas: [idea] }, [ctx.t("focus.park.done", { id: idea.id })]);
    }),
};

export const unparkCommand: CommandSpec = {
  path: ["unpark"],
  summaryKey: "command.unpark.summary",
  usage: UNPARK_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const id = args.positionals[0]?.trim() ?? "";
      const idea = id === "" ? undefined : unpark(ctx.runtime, fmPaths(root), id);
      if (idea === undefined)
        return failureFrom(ctx.t, usageProblem("invalid_arguments", "focus.unpark.missing", UNPARK_USAGE, { id }));
      return success({ schema: PARKING_SCHEMA, ideas: [idea] }, [ideaLine(ctx.t, idea)]);
    }),
};
