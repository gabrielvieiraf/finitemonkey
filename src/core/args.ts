import { parseArgs } from "node:util";

import type { CommandSpec, OptionsConfig, OptionValues } from "../commands/types.js";
import { accept, type Parsed, reject } from "./parsed.js";
import { type Problem, usageProblem } from "./problem.js";

export const GLOBAL_OPTIONS = {
  json: { type: "boolean" },
  lang: { type: "string" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
} as const satisfies OptionsConfig;

export interface LooseArgs {
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly version: boolean;
  readonly help: boolean;
  readonly lang: string | undefined;
}

const flag = (values: OptionValues, name: string): boolean => values[name] === true;

export const looseArgs = (argv: readonly string[]): LooseArgs => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: GLOBAL_OPTIONS,
    strict: false,
    allowPositionals: true,
  });
  const lang = values.lang;
  return {
    positionals,
    json: flag(values, "json"),
    yes: flag(values, "yes"),
    dryRun: flag(values, "dry-run"),
    version: flag(values, "version"),
    help: flag(values, "help"),
    lang: typeof lang === "string" ? lang : undefined,
  };
};

export interface Resolved {
  readonly spec: CommandSpec;
  readonly consumed: number;
}

export const resolveCommand = (
  registry: readonly CommandSpec[],
  positionals: readonly string[],
): Resolved | undefined =>
  registry
    .filter((spec) => spec.path.every((part, index) => positionals[index] === part))
    .reduce<Resolved | undefined>(
      (best, spec) =>
        best === undefined || spec.path.length > best.consumed ? { spec, consumed: spec.path.length } : best,
      undefined,
    );

export interface CommandArgs {
  readonly values: OptionValues;
  readonly positionals: readonly string[];
}

export const strictArgs = (argv: readonly string[], spec: CommandSpec): Parsed<CommandArgs, Problem> => {
  const fix = `finitemonkey help ${spec.path.join(" ")}`;
  let parsed: { values: OptionValues; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { ...GLOBAL_OPTIONS, ...spec.options },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return reject(usageProblem("invalid_arguments", "error.invalid_arguments", fix, { detail }));
  }
  const rest = parsed.positionals.slice(spec.path.length);
  const max = spec.maxPositionals ?? 0;
  const extra = rest[max];
  if (extra !== undefined) {
    return reject(usageProblem("unexpected_argument", "error.unexpected_argument", fix, { argument: extra }));
  }
  return accept({ values: parsed.values, positionals: rest });
};

export const stringOption = (values: OptionValues, name: string): string | undefined => {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
};

export const listOption = (values: OptionValues, name: string): readonly string[] => {
  const value = values[name];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim() !== "");
};
