import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { appendInbox } from "../fronts/routing.js";
import { readFronts } from "../fronts/state.js";
import { mainRoot } from "./fronts.js";
import type { CommandSpec } from "./types.js";

export const FRONTS_ROUTE_SCHEMA = "finitemonkey/fronts-route@1";

export const frontsRouteCommand: CommandSpec = {
  path: ["fronts", "route"],
  summaryKey: "fronts.command.route",
  usage: 'finitemonkey fronts route <front> "<message>" [--contract] [--json]',
  status: "ready",
  options: { contract: { type: "boolean" } },
  maxPositionals: 2,
  run: (ctx, args): Promise<CommandResult> => {
    const [id = "", message = ""] = args.positionals;
    const root = mainRoot(ctx);
    const state = readFronts(ctx.runtime, root);
    const front = state.ok ? state.value.fronts.find((item) => item.id === id) : undefined;
    if (front === undefined || message.trim() === "") {
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("fronts_failed", "fronts.error.unknown_front", "finitemonkey fronts status", { id }),
        ),
      );
    }
    const kind = args.values["contract"] === true ? "contract" : "message";
    appendInbox(ctx.runtime, root, id, message.trim(), kind);
    return Promise.resolve(
      success({ schema: FRONTS_ROUTE_SCHEMA, front: id, kind, message: message.trim() }, [
        ctx.t(kind === "contract" ? "fronts.route.contract" : "fronts.route.message", { front: id }),
      ]),
    );
  },
};
