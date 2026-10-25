import type { ParseArgsConfig } from "node:util";

import type { CommandArgs } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import type { CommandResult } from "../core/result.js";
import type { MessageKey } from "../i18n/catalogs.js";

export type OptionsConfig = NonNullable<ParseArgsConfig["options"]>;

export type OptionValue = string | boolean | (string | boolean)[] | undefined;

export type OptionValues = Readonly<Record<string, OptionValue>>;

export type CommandStatus = "ready" | "planned";

export interface CommandSpec {
  readonly path: readonly [string, ...string[]];
  readonly summaryKey: MessageKey;
  readonly usage: string;
  readonly status: CommandStatus;
  readonly options?: OptionsConfig;
  readonly maxPositionals?: number;
  readonly run: (ctx: Ctx, args: CommandArgs, registry: readonly CommandSpec[]) => Promise<CommandResult>;
}

export const commandName = (spec: CommandSpec): string => spec.path.join(" ");
