import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

import { finitemonkeyPlugin } from "./eslint/no-comments.mjs";

const shared = {
  plugins: { finitemonkey: finitemonkeyPlugin, "simple-import-sort": simpleImportSort },
  rules: {
    "finitemonkey/no-comments": "error",
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error",
    "no-restricted-syntax": [
      "error",
      { selector: "ExportDefaultDeclaration", message: "Use named exports." },
      { selector: "TSEnumDeclaration", message: "Use an `as const` array or object instead of enum." },
    ],
    eqeqeq: ["error", "always"],
    "prefer-const": "error",
    "no-console": "off",
    "max-lines": ["error", { max: 300, skipBlankLines: true }],
  },
};

export default defineConfig([
  globalIgnores(["dist", "node_modules", "coverage"]),
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    ...shared,
    rules: {
      ...shared.rules,
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["describe", "it", "test", "suite", "after", "before"] },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
    ...shared,
  },
  {
    files: ["src/**/*.ts", "assets/scripts/**/*.ts"],
    rules: { "max-lines-per-function": ["error", { max: 50, skipBlankLines: true }] },
  },
  {
    files: ["eslint.config.mjs", "commitlint.config.mjs"],
    rules: { "no-restricted-syntax": "off" },
  },
]);
