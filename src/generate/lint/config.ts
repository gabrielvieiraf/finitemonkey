import { esImport } from "../js.js";
import type { Stack } from "../stack.js";
import { noCommentsRule } from "./no-comments.js";

export const LINT_PRESETS = ["no-comments", "architecture", "strict"] as const;

export type LintPreset = (typeof LINT_PRESETS)[number];

export const LINT_CONFIG_FILE = "eslint.finitemonkey.mjs";

export interface LintMessages {
  readonly noComments: string;
  readonly network: (api: string) => string;
  readonly mocks: (mocks: string) => string;
  readonly client: (client: string, api: string) => string;
  readonly namedExports: string;
  readonly noEnum: string;
}

export type Block = Readonly<Record<string, unknown>>;

const PARSER = "@@tseslint.parser@@";
const TS_PLUGIN = "@@tseslint.plugin@@";
const NO_COMMENTS_PLUGIN = "@@noComments@@";

const SCREENS = ["src/screens", "src/pages", "src/views", "src/components"] as const;
const API = ["src/api", "src/services/api", "src/lib/api"] as const;
const MOCKS = ["src/mocks", "mocks"] as const;
const SOURCES = ["src", "app", "lib", "server"] as const;
const ROUTES = ["app/**", "pages/**", "src/app/**", "src/pages/**", "src/routes/**", "app/routes/**"];
const NETWORK_GLOBALS = ["fetch", "XMLHttpRequest", "EventSource", "WebSocket"] as const;
const TESTS = ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/test/**", "**/tests/**"];
const JS = "js,jsx,mjs,cjs";
const TS = "ts,tsx,mts,cts";

const extensions = (stack: Stack): string => (stack.tsEslint ? `${JS},${TS}` : JS);

const sourceGlobs = (stack: Stack): readonly string[] => {
  const dirs = stack.dirs(SOURCES);
  return dirs.length === 0 ? [`**/*.{${extensions(stack)}}`] : dirs.map((dir) => `${dir}/**/*.{${extensions(stack)}}`);
};

const under = (dir: string): string => `${dir}/**`;

const noCommentsBlocks = (stack: Stack): readonly Block[] => [
  {
    files: [`**/*.{${extensions(stack)}}`],
    plugins: { finitemonkey: { meta: { name: "finitemonkey" }, rules: { "no-comments": NO_COMMENTS_PLUGIN } } },
    rules: { "finitemonkey/no-comments": "error" },
  },
];

const strictBlocks = (stack: Stack, messages: LintMessages): readonly Block[] => {
  const files = sourceGlobs(stack);
  const restricted = [
    { selector: "ExportDefaultDeclaration", message: messages.namedExports },
    ...(stack.tsEslint ? [{ selector: "TSEnumDeclaration", message: messages.noEnum }] : []),
  ];
  return [
    {
      files,
      ...(stack.tsEslint ? { plugins: { "@typescript-eslint": TS_PLUGIN } } : {}),
      rules: {
        "no-console": "error",
        ...(stack.tsEslint
          ? {
              "@typescript-eslint/no-explicit-any": "error",
              "@typescript-eslint/no-non-null-assertion": "error",
              "@typescript-eslint/consistent-type-imports": "error",
            }
          : {}),
      },
    },
    {
      files,
      ignores: ["**/*.config.*", "**/*.d.ts", ...(stack.defaultExports ? ROUTES : [])],
      rules: { "no-restricted-syntax": ["error", ...restricted] },
    },
  ];
};

const fetchBlocks = (stack: Stack, messages: LintMessages, api: string): readonly Block[] => {
  const screens = stack.dirs(SCREENS);
  if (screens.length === 0) return [];
  const globals = NETWORK_GLOBALS.map((name) => ({ name, message: messages.network(api) }));
  return [{ files: screens.map(under), rules: { "no-restricted-globals": ["error", ...globals] } }];
};

const importBlocks = (stack: Stack, messages: LintMessages, api: string): readonly Block[] => {
  const mocks = stack.dirs(MOCKS)[0] ?? "src/mocks";
  const mockPattern = { group: ["**/mocks", "**/mocks/**", "msw", "msw/*"], message: messages.mocks(mocks) };
  const clients = stack.dirs(API).length === 0 ? [] : stack.httpClients;
  const paths = clients.map((name) => ({ name, message: messages.client(name, api) }));
  const ignores = [...stack.dirs(MOCKS).map(under), ...TESTS];
  const app = {
    files: sourceGlobs(stack),
    ignores: [...ignores, ...stack.dirs(API).map(under)],
    rules: { "no-restricted-imports": ["error", { patterns: [mockPattern], ...(paths.length > 0 ? { paths } : {}) }] },
  };
  const layer = stack.dirs(API).map((dir) => ({
    files: [under(dir)],
    ignores,
    rules: { "no-restricted-imports": ["error", { patterns: [mockPattern] }] },
  }));
  return [app, ...layer];
};

const architectureBlocks = (stack: Stack, messages: LintMessages): readonly Block[] => {
  const api = stack.dirs(API)[0] ?? "src/api";
  if (stack.dirs(SOURCES).length === 0) return [];
  return [...fetchBlocks(stack, messages, api), ...importBlocks(stack, messages, api)];
};

export const lintBlocks = (
  stack: Stack,
  presets: ReadonlySet<LintPreset>,
  messages: LintMessages,
): readonly Block[] => [
  ...(stack.tsEslint ? [{ files: [`**/*.{${TS}}`], languageOptions: { parser: PARSER } }] : []),
  ...(presets.has("no-comments") ? noCommentsBlocks(stack) : []),
  ...(presets.has("strict") ? strictBlocks(stack, messages) : []),
  ...(presets.has("architecture") ? architectureBlocks(stack, messages) : []),
];

const IDENTIFIER_KEY = /^(\s*)"([A-Za-z_$][\w$]*)":/gm;

const source = (blocks: readonly Block[]): string =>
  JSON.stringify(blocks, null, 2)
    .replace(IDENTIFIER_KEY, "$1$2:")
    .replaceAll(`"${PARSER}"`, "tseslint.parser")
    .replaceAll(`"${TS_PLUGIN}"`, "tseslint.plugin")
    .replaceAll(`"${NO_COMMENTS_PLUGIN}"`, "noComments");

export const renderLintConfig = (stack: Stack, blocks: readonly Block[], messages: LintMessages): string => {
  const text = source(blocks);
  const usesComments = text.includes("noComments");
  return [
    ...(stack.tsEslint ? [esImport("tseslint", "typescript-eslint"), ""] : []),
    ...(usesComments ? noCommentsRule(messages.noComments) : []),
    `export const finitemonkey = ${text};`,
    "",
  ].join("\n");
};
