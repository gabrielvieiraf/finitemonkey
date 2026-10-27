import { normalizeCommand } from "../shell/normalize.js";
import type { Dialect, ShellCommand } from "../shell/types.js";

export type Ecosystem = "npm" | "pypi";

export interface RequestedPackage {
  readonly ecosystem: Ecosystem;
  readonly name: string;
  readonly version: string | undefined;
  readonly tool: string;
}

interface Installer {
  readonly ecosystem: Ecosystem;
  readonly tool: string;
  readonly args: readonly string[];
}

const NPM_ADD: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(["i", "install", "add", "in", "ins", "inst", "insta", "instal", "isnt", "isntall"]),
  pnpm: new Set(["add"]),
  yarn: new Set(["add"]),
  bun: new Set(["add", "a", "i", "install"]),
};

const NPM_VALUE_FLAGS = new Set([
  "--tag",
  "--registry",
  "--prefix",
  "-w",
  "--workspace",
  "--filter",
  "--cwd",
  "--omit",
]);
const PIP_VALUE_FLAGS = new Set([
  "-r",
  "--requirement",
  "-c",
  "--constraint",
  "-e",
  "--editable",
  "-i",
  "--index-url",
  "--extra-index-url",
  "-t",
  "--target",
  "--prefix",
  "-f",
  "--find-links",
  "--python",
  "-p",
  "--group",
  "--optional",
  "--extra",
  "--index",
  "--default-index",
  "--package",
  "--directory",
  "--project",
]);

const PYTHONS = /^(?:python(?:3(?:\.\d+)?)?|py)$/;

const pipArgs = (command: ShellCommand): readonly string[] | undefined => {
  const { program, args } = command;
  if ((program === "pip" || program === "pip3") && args[0] === "install") return args.slice(1);
  if (PYTHONS.test(program) && args[0] === "-m" && (args[1] === "pip" || args[1] === "pip3") && args[2] === "install")
    return args.slice(3);
  if (program === "uv" && args[0] === "add") return args.slice(1);
  if (program === "uv" && args[0] === "pip" && args[1] === "install") return args.slice(2);
  return undefined;
};

const installerOf = (command: ShellCommand): Installer | undefined => {
  const adds = NPM_ADD[command.program];
  const [verb, ...rest] = command.args;
  if (adds !== undefined && verb !== undefined && adds.has(verb))
    return { ecosystem: "npm", tool: command.program, args: rest };
  const pip = pipArgs(command);
  return pip === undefined ? undefined : { ecosystem: "pypi", tool: command.program, args: pip };
};

const positionals = (args: readonly string[], valueFlags: ReadonlySet<string>): readonly string[] => {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-")) {
      if (valueFlags.has(arg)) index += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
};

const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const NOT_REGISTRY = /^(?:\.|\/|~|file:|link:|git|https?:|npm:|workspace:|github:)|\.tgz$/;

const npmSpec = (word: string): Pick<RequestedPackage, "name" | "version"> | undefined => {
  if (NOT_REGISTRY.test(word)) return undefined;
  const at = word.indexOf("@", 1);
  const name = at === -1 ? word : word.slice(0, at);
  const version = at === -1 ? undefined : word.slice(at + 1);
  if (!NPM_NAME.test(name) || version?.includes(":") === true) return undefined;
  return { name, version: version === "" ? undefined : version };
};

const PYPI_SPEC = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:(==|===|>=|<=|~=|!=|>|<)\s*([^,;\s]+))?/;

const pypiSpec = (word: string): Pick<RequestedPackage, "name" | "version"> | undefined => {
  if (/^(?:\.|\/|~|https?:|git\+|file:)/.test(word) || /\.(?:whl|tar\.gz|zip)$/.test(word)) return undefined;
  const match = PYPI_SPEC.exec(word);
  const name = match?.[1];
  if (match === null || name === undefined || match[0].length === 0) return undefined;
  const exact = match[2] === "==" || match[2] === "===";
  return { name: name.toLowerCase().replace(/[._]+/g, "-"), version: exact ? match[3] : undefined };
};

const requested = (installer: Installer): readonly RequestedPackage[] => {
  const npm = installer.ecosystem === "npm";
  return positionals(installer.args, npm ? NPM_VALUE_FLAGS : PIP_VALUE_FLAGS).flatMap((word) => {
    const spec = npm ? npmSpec(word) : pypiSpec(word);
    return spec === undefined ? [] : [{ ...spec, ecosystem: installer.ecosystem, tool: installer.tool }];
  });
};

export const packagesInCommand = (text: string, dialect: Dialect = "bash"): readonly RequestedPackage[] =>
  normalizeCommand(text, dialect).commands.flatMap((command) => {
    const installer = installerOf(command);
    return installer === undefined ? [] : requested(installer);
  });
