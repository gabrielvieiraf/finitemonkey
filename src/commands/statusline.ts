import { success } from "../core/result.js";
import { renderStatusLine } from "../statusline/run.js";
import type { CommandSpec } from "./types.js";

export const statuslineCommand: CommandSpec = {
  path: ["statusline"],
  summaryKey: "command.statusline.summary",
  usage: "finitemonkey statusline",
  status: "ready",
  run: async (ctx) => success({}, [await renderStatusLine(ctx)]),
};
