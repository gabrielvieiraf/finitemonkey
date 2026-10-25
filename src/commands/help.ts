import { resolveCommand } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success, type SuccessResult } from "../core/result.js";
import type { MessageKey } from "../i18n/catalogs.js";
import { commandName, type CommandSpec, type CommandStatus } from "./types.js";

export const GLOBAL_FLAGS = [
  { flag: "--json", key: "flag.json" },
  { flag: "--lang <pt-BR|en|es>", key: "flag.lang" },
  { flag: "--yes, -y", key: "flag.yes" },
  { flag: "--dry-run", key: "flag.dry_run" },
  { flag: "--version, -v", key: "flag.version" },
  { flag: "--help, -h", key: "flag.help" },
] as const satisfies readonly { readonly flag: string; readonly key: MessageKey }[];

export interface CommandHelp {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  readonly status: CommandStatus;
  readonly options: readonly string[];
}

export interface HelpData {
  readonly commands: readonly CommandHelp[];
  readonly flags: readonly { readonly flag: string; readonly summary: string }[];
}

const pad = (text: string, width: number): string => text.padEnd(Math.max(width, text.length + 1));

const describe = (ctx: Ctx, spec: CommandSpec): CommandHelp => ({
  name: commandName(spec),
  usage: spec.usage,
  summary: ctx.t(spec.summaryKey),
  status: spec.status,
  options: Object.keys(spec.options ?? {}).map((name) => `--${name}`),
});

const summaryLine = (ctx: Ctx, help: CommandHelp): string =>
  help.status === "planned" ? `${help.summary} ${ctx.t("help.planned")}` : help.summary;

const overview = (ctx: Ctx, registry: readonly CommandSpec[]): SuccessResult<HelpData> => {
  const commands = registry.map((spec) => describe(ctx, spec));
  const flags = GLOBAL_FLAGS.map(({ flag, key }) => ({ flag, summary: ctx.t(key) }));
  const width = Math.max(...commands.map(({ name }) => name.length)) + 2;
  const flagWidth = Math.max(...flags.map(({ flag }) => flag.length)) + 2;
  const human = [
    `finitemonkey ${ctx.version}`,
    ctx.t("help.tagline"),
    "",
    `${ctx.t("help.usage")}: finitemonkey <${ctx.t("help.command")}> [flags]`,
    "",
    `${ctx.t("help.commands")}:`,
    ...commands.map((help) => `  ${pad(help.name, width)}${summaryLine(ctx, help)}`),
    "",
    `${ctx.t("help.flags")}:`,
    ...flags.map(({ flag, summary }) => `  ${pad(flag, flagWidth)}${summary}`),
    "",
    ctx.t("help.more"),
  ];
  return success({ commands, flags }, human);
};

export const helpFor = (ctx: Ctx, spec: CommandSpec): SuccessResult<{ readonly command: CommandHelp }> => {
  const help = describe(ctx, spec);
  const human = [
    `${ctx.t("help.usage")}: ${help.usage}`,
    "",
    summaryLine(ctx, help),
    ...(help.options.length > 0 ? ["", `${ctx.t("help.options")}: ${help.options.join(", ")}`] : []),
  ];
  return success({ command: help }, human);
};

const topicHelp = (ctx: Ctx, registry: readonly CommandSpec[], topic: readonly string[]): CommandResult => {
  const resolved = resolveCommand(registry, topic);
  if (resolved !== undefined) return helpFor(ctx, resolved.spec);
  const problem = usageProblem("unknown_command", "error.unknown_command", "finitemonkey help", {
    command: topic.join(" "),
  });
  return failureFrom(ctx.t, problem);
};

export const helpCommand: CommandSpec = {
  path: ["help"],
  summaryKey: "command.help.summary",
  usage: "finitemonkey help [command]",
  status: "ready",
  maxPositionals: 3,
  run: (ctx, args, registry) =>
    Promise.resolve(
      args.positionals.length === 0 ? overview(ctx, registry) : topicHelp(ctx, registry, args.positionals),
    ),
};
