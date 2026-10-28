import type { Stack } from "../../generate/stack.js";
import type { PackageManager } from "../../install/detect.js";
import type { Step } from "./steps.js";

export interface Toolchain {
  readonly setup: readonly Step[];
  readonly checks: readonly Step[];
  readonly build: readonly Step[];
}

export interface ToolchainInput {
  readonly stack: Stack;
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string | undefined;
}

const INSTALL: Readonly<Record<PackageManager, string>> = {
  npm: "npm ci",
  pnpm: "pnpm install --frozen-lockfile",
  yarn: "yarn install --immutable",
  bun: "bun install --frozen-lockfile",
};

const RUN: Readonly<Record<PackageManager, string>> = {
  npm: "npm run",
  pnpm: "pnpm run",
  yarn: "yarn run",
  bun: "bun run",
};
const EXEC: Readonly<Record<PackageManager, string>> = { npm: "npx", pnpm: "pnpm exec", yarn: "yarn", bun: "bunx" };
const NPM_PLACEHOLDER_TEST = "no test specified";

const firstScript = (stack: Stack, names: readonly string[]): string | undefined =>
  names.find((name) => stack.scripts.has(name));

const nodeVersion = (input: ToolchainInput): Readonly<Record<string, string>> => {
  const file = [".nvmrc", ".node-version"].find(input.exists);
  return file === undefined ? { "node-version": "lts/*" } : { "node-version-file": file };
};

export const setupNode = (input: ToolchainInput, manager: PackageManager | undefined): readonly Step[] => [
  ...(manager === "pnpm" ? [{ uses: "pnpm/action-setup" as const }] : []),
  ...(manager === "bun" ? [{ uses: "oven-sh/setup-bun" as const }] : []),
  {
    uses: "actions/setup-node",
    with: {
      ...nodeVersion(input),
      ...(manager === undefined || manager === "bun" ? {} : { cache: manager }),
    },
  },
];

const yarnInstall = (input: ToolchainInput): string =>
  input.exists(".yarnrc.yml") ? INSTALL.yarn : "yarn install --frozen-lockfile";

const nodeChecks = (input: ToolchainInput, manager: PackageManager): readonly Step[] => {
  const { stack } = input;
  const run = (script: string): Step => ({ run: `${RUN[manager]} ${script}` });
  const exec = (command: string): Step => ({ run: `${EXEC[manager]} ${command}` });
  const types = firstScript(stack, ["typecheck", "type-check", "types", "tsc"]);
  const format = firstScript(stack, ["format:check", "fmt:check", "prettier:check", "check-format"]);
  const testScript = input.read("package.json")?.match(/"test"\s*:\s*"([^"]*)"/)?.[1] ?? "";
  return [
    ...(types !== undefined ? [run(types)] : input.exists("tsconfig.json") ? [exec("tsc --noEmit")] : []),
    ...(format !== undefined ? [run(format)] : stack.dependencies.has("prettier") ? [exec("prettier --check .")] : []),
    ...(stack.scripts.has("lint") ? [run("lint")] : stack.eslint ? [exec("eslint .")] : []),
    ...(stack.scripts.has("test") && !testScript.includes(NPM_PLACEHOLDER_TEST) ? [run("test")] : []),
  ];
};

const pythonSetup = (input: ToolchainInput): readonly Step[] => {
  const version = input.exists(".python-version")
    ? { "python-version-file": ".python-version" }
    : { "python-version": '"3.12"' };
  const uv = input.exists("uv.lock");
  return [
    { uses: "actions/setup-python", with: version },
    ...(uv ? [{ uses: "astral-sh/setup-uv" as const }, { run: "uv sync --locked" }] : []),
    ...(!uv && input.exists("requirements.txt") ? [{ run: "python -m pip install -r requirements.txt" }] : []),
  ];
};

const pythonChecks = (input: ToolchainInput): readonly Step[] => {
  const project = `${input.read("pyproject.toml") ?? ""}\n${input.read("requirements.txt") ?? ""}`;
  const prefix = input.exists("uv.lock") ? "uv run " : "";
  return [
    ...(/\bruff\b/.test(project) ? [{ run: `${prefix}ruff check .` }, { run: `${prefix}ruff format --check .` }] : []),
    ...(input.exists("scripts/check_no_comments.py") ? [{ run: "python scripts/check_no_comments.py ." }] : []),
    ...(/\bpytest\b/.test(project) ? [{ run: `${prefix}pytest` }] : []),
  ];
};

export const toolchain = (input: ToolchainInput): Toolchain => {
  const manager = input.stack.packageManager;
  const install = manager === undefined ? [] : [{ run: manager === "yarn" ? yarnInstall(input) : INSTALL[manager] }];
  const node = manager === undefined ? [] : nodeChecks(input, manager);
  const python = input.stack.python;
  return {
    setup: [...setupNode(input, manager), ...install, ...(python ? pythonSetup(input) : [])],
    checks: [...node, ...(python ? pythonChecks(input) : [])],
    build: manager !== undefined && input.stack.scripts.has("build") ? [{ run: `${RUN[manager]} build` }] : [],
  };
};
