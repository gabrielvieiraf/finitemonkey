import { helpFor } from "../commands/help.js";
import { commandName, type CommandSpec } from "../commands/types.js";
import { type LooseArgs, resolveCommand, strictArgs } from "./args.js";
import type { Ctx } from "./context.js";
import { type Problem, usageProblem } from "./problem.js";
import { type CommandResult, failureFrom } from "./result.js";
import { closest } from "./suggest.js";

export interface Dispatched {
  readonly name: string;
  readonly execute: () => Promise<CommandResult>;
}

const unknownCommand = (registry: readonly CommandSpec[], attempted: string): Problem => {
  const suggestion = closest(attempted, registry.map(commandName));
  return suggestion === undefined
    ? usageProblem("unknown_command", "error.unknown_command", "finitemonkey help", { command: attempted })
    : usageProblem("unknown_command", "error.unknown_command_suggest", `finitemonkey ${suggestion}`, {
        command: attempted,
        suggestion,
      });
};

const failWith = (ctx: Ctx, name: string, problem: Problem): Dispatched => ({
  name,
  execute: () => Promise.resolve(failureFrom(ctx.t, problem)),
});

const invoke = (ctx: Ctx, argv: readonly string[], spec: CommandSpec, registry: readonly CommandSpec[]): Dispatched => {
  const name = commandName(spec);
  const args = strictArgs(argv, spec);
  if (!args.ok) return failWith(ctx, name, args.error);
  return { name, execute: () => spec.run(ctx, args.value, registry) };
};

const builtin = (registry: readonly CommandSpec[], name: "help" | "version"): CommandSpec | undefined =>
  registry.find((spec) => commandName(spec) === name);

export const dispatch = (
  ctx: Ctx,
  argv: readonly string[],
  loose: LooseArgs,
  registry: readonly CommandSpec[],
): Dispatched => {
  const resolved = resolveCommand(registry, loose.positionals);
  const attempted = loose.positionals[0];
  if (resolved === undefined && attempted !== undefined) {
    return failWith(ctx, attempted, unknownCommand(registry, attempted));
  }
  const wanted = loose.version && !loose.help ? "version" : "help";
  if (resolved === undefined || (loose.version && !loose.help)) {
    const spec = builtin(registry, wanted);
    if (spec === undefined) return failWith(ctx, wanted, unknownCommand(registry, wanted));
    return { name: wanted, execute: () => spec.run(ctx, { values: {}, positionals: [] }, registry) };
  }
  if (loose.help) return { name: "help", execute: () => Promise.resolve(helpFor(ctx, resolved.spec)) };
  return invoke(ctx, argv, resolved.spec, registry);
};
