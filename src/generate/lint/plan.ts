import type { Translate } from "../../i18n/translate.js";
import type { GenFile } from "../files.js";
import type { Stack } from "../stack.js";
import { LINT_CONFIG_FILE, lintBlocks, type LintMessages, type LintPreset, renderLintConfig } from "./config.js";
import { freshEslintConfig, IMPORT_LINE, mergeEslintConfig, SPREAD_LINE } from "./merge.js";
import { PYTHON_CHECKER, pythonChecker } from "./no-comments.js";

export interface LintPlan {
  readonly files: readonly GenFile[];
  readonly notes: readonly string[];
}

export const lintMessages = (t: Translate): LintMessages => ({
  noComments: t("gen.lint.no_comments"),
  network: (api) => t("gen.lint.fetch", { api }),
  mocks: (mocks) => t("gen.lint.mocks", { mocks }),
  client: (client, api) => t("gen.lint.client", { client, api }),
  namedExports: t("gen.lint.named_exports"),
  noEnum: t("gen.lint.no_enum"),
});

export type ReadFile = (path: string) => string | undefined;

const eslintFiles = (t: Translate, stack: Stack, presets: ReadonlySet<LintPreset>, read: ReadFile): LintPlan => {
  const messages = lintMessages(t);
  const blocks = lintBlocks(stack, presets, messages);
  const helper: GenFile = { path: LINT_CONFIG_FILE, text: renderLintConfig(stack, blocks, messages) };
  const manual = [t("gen.lint.manual", { file: stack.eslintConfig ?? "", import: IMPORT_LINE, spread: SPREAD_LINE })];
  const notes = [
    ...(stack.eslint
      ? []
      : [t("gen.lint.install", { packages: stack.typescript ? "eslint typescript-eslint" : "eslint" })]),
    ...(stack.typescript && !stack.tsEslint ? [t("gen.lint.no_ts_eslint")] : []),
  ];
  if (stack.legacyEslint !== undefined)
    return { files: [helper], notes: [...notes, t("gen.lint.legacy", { file: stack.legacyEslint })] };
  if (stack.eslintConfig === undefined)
    return { files: [helper, { path: "eslint.config.mjs", text: freshEslintConfig() }], notes };
  const current = read(stack.eslintConfig) ?? "";
  if (mergeEslintConfig(current) === undefined) return { files: [helper], notes: [...notes, ...manual] };
  return {
    files: [helper, { path: stack.eslintConfig, text: freshEslintConfig(), merge: mergeEslintConfig }],
    notes,
  };
};

export const lintPlan = (t: Translate, stack: Stack, presets: ReadonlySet<LintPreset>, read: ReadFile): LintPlan => {
  const eslint = stack.node ? eslintFiles(t, stack, presets, read) : { files: [], notes: [] };
  const python =
    stack.python && presets.has("no-comments")
      ? [{ path: PYTHON_CHECKER, text: pythonChecker(t("gen.lint.no_comments")) }]
      : [];
  const pythonNotes = python.length > 0 ? [t("gen.lint.python", { file: PYTHON_CHECKER })] : [];
  const none = eslint.files.length === 0 && python.length === 0 ? [t("gen.lint.no_stack")] : [];
  return { files: [...eslint.files, ...python], notes: [...eslint.notes, ...pythonNotes, ...none] };
};
