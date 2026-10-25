export interface OptionSpec {
  readonly known: readonly string[];
  readonly withValue: readonly string[];
  readonly shortWithValue: string;
}

export interface ParsedOptions {
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, readonly string[]>;
  readonly positionals: readonly string[];
  readonly paths: readonly string[];
  readonly dashdash: boolean;
}

interface Building {
  readonly flags: Set<string>;
  readonly values: Map<string, string[]>;
  readonly positionals: string[];
}

const canonical = (name: string, spec: OptionSpec): string => {
  if (spec.known.includes(name)) return name;
  const matches = spec.known.filter((option) => option.startsWith(name));
  return matches.length === 1 ? (matches[0] ?? name) : name;
};

const addValue = (building: Building, name: string, value: string): void => {
  building.values.set(name, [...(building.values.get(name) ?? []), value]);
  building.flags.add(name);
};

const longOption = (building: Building, arg: string, next: string | undefined, spec: OptionSpec): number => {
  const equals = arg.indexOf("=");
  const name = canonical(equals < 0 ? arg : arg.slice(0, equals), spec);
  if (equals >= 0) {
    addValue(building, name, arg.slice(equals + 1));
    return 1;
  }
  if (spec.withValue.includes(name) && next !== undefined) {
    addValue(building, name, next);
    return 2;
  }
  building.flags.add(name);
  return 1;
};

const shortCluster = (building: Building, arg: string, next: string | undefined, spec: OptionSpec): number => {
  for (let index = 1; index < arg.length; index += 1) {
    const letter = arg.charAt(index);
    const name = `-${letter}`;
    if (spec.shortWithValue.includes(letter)) {
      const attached = arg.slice(index + 1);
      if (attached !== "") {
        addValue(building, name, attached);
        return 1;
      }
      if (next === undefined) {
        building.flags.add(name);
        return 1;
      }
      addValue(building, name, next);
      return 2;
    }
    building.flags.add(name);
  }
  return 1;
};

export const parseOptions = (args: readonly string[], spec: OptionSpec): ParsedOptions => {
  const building: Building = { flags: new Set(), values: new Map(), positionals: [] };
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    const next = args[index + 1];
    if (arg === "--") {
      return { ...building, paths: args.slice(index + 1), dashdash: true };
    }
    if (arg.startsWith("--")) index += longOption(building, arg, next, spec);
    else if (arg.startsWith("-") && arg.length > 1 && !/^-\d+$/.test(arg)) {
      index += shortCluster(building, arg, next, spec);
    } else {
      building.positionals.push(arg);
      index += 1;
    }
  }
  return { ...building, paths: [], dashdash: false };
};

export const hasAny = (parsed: ParsedOptions, ...names: readonly string[]): boolean =>
  names.some((name) => parsed.flags.has(name));

export const valuesOf = (parsed: ParsedOptions, ...names: readonly string[]): readonly string[] =>
  names.flatMap((name) => parsed.values.get(name) ?? []);

export const optionSpec = (known: readonly string[], withValue: readonly string[] = [], shortWithValue = ""): OptionSpec => ({
  known,
  withValue,
  shortWithValue,
});
