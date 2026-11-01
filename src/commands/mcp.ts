import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { readAll } from "../hooks/stdin.js";
import { confirmTool, pinTools, type ToolDescription } from "../policy/mcp-pins.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const MCP_PINS_SCHEMA = "finitemonkey/mcp-pins@1";

const PIN_USAGE = "finitemonkey mcp pin [--file <tools.json>] (or the tool list as JSON on stdin)";
const CONFIRM_USAGE = "finitemonkey mcp confirm <mcp__server__tool>";

const registryText = async (ctx: Ctx, file: string | undefined): Promise<string | undefined> => {
  if (file === undefined) return ctx.io.stdin.isTTY === true ? undefined : readAll(ctx.io.stdin);
  const text = ctx.runtime.readText(toAbsolutePath(file, projectRoot(ctx)));
  return text.ok ? text.value : undefined;
};

export const parseRegistry = (text: string | undefined): readonly ToolDescription[] | undefined => {
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  const tools = parsed?.ok === true ? parsed.value["tools"] : undefined;
  if (!Array.isArray(tools)) return undefined;
  return tools.flatMap((tool: unknown) =>
    isRecord(tool) && typeof tool["name"] === "string" && typeof tool["description"] === "string"
      ? [{ name: tool["name"], description: tool["description"] }]
      : [],
  );
};

const pinned = (ctx: Ctx, tools: readonly ToolDescription[]): CommandResult => {
  const report = pinTools(ctx.runtime, fmPaths(projectRoot(ctx)), tools);
  const human = [
    ctx.t("mcp.pin.summary", { count: tools.length, added: report.added.length }),
    ...report.changed.map((tool) => ctx.t("mcp.pin.changed", { tool })),
    ...(report.pending.length > report.changed.length
      ? [ctx.t("mcp.pin.pending", { tools: report.pending.join(", ") })]
      : []),
  ];
  return success({ schema: MCP_PINS_SCHEMA, ...report }, human);
};

export const mcpPinCommand: CommandSpec = {
  path: ["mcp", "pin"],
  summaryKey: "command.mcp_pin.summary",
  usage: PIN_USAGE,
  status: "ready",
  maxPositionals: 0,
  options: { file: { type: "string" } },
  run: async (ctx, args): Promise<CommandResult> => {
    const tools = parseRegistry(await registryText(ctx, stringOption(args.values, "file")));
    if (tools === undefined)
      return failureFrom(ctx.t, usageProblem("invalid_arguments", "mcp.error.registry", PIN_USAGE));
    return pinned(ctx, tools);
  },
};

export const mcpConfirmCommand: CommandSpec = {
  path: ["mcp", "confirm"],
  summaryKey: "command.mcp_confirm.summary",
  usage: CONFIRM_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    if (!isPerson(ctx))
      return Promise.resolve(failureFrom(ctx.t, needsPersonProblem("mcp.error.person_only", CONFIRM_USAGE)));
    const tool = args.positionals[0] ?? "";
    if (!confirmTool(ctx.runtime, fmPaths(projectRoot(ctx)), tool))
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "mcp.error.unchanged", CONFIRM_USAGE, { tool })),
      );
    const data = { schema: MCP_PINS_SCHEMA, added: [], changed: [], pending: [], confirmed: tool };
    return Promise.resolve(success(data, [ctx.t("mcp.confirm.done", { tool })]));
  },
};
