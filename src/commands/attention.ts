import { attentionQueue } from "../attention/queue.js";
import { success } from "../core/result.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const attentionCommand: CommandSpec = {
  path: ["attention"],
  summaryKey: "command.attention.summary",
  usage: "finitemonkey attention [--json]",
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const queue = attentionQueue(ctx.runtime, root);
      const lines = queue.asks.map((ask) =>
        ctx.t("attention.queue.line", { front: ask.front, kind: ask.kind, text: ask.text, minutes: ask.waitMinutes }),
      );
      return success(queue, lines.length === 0 ? [ctx.t("attention.queue.empty")] : lines);
    }),
};
