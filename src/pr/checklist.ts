import { basename } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import type { Runtime } from "../core/runtime.js";
import { LOCKFILES } from "../merge/resolve-file.js";
import type { ChangedFile, ScopeCheck } from "./scope.js";

const CODEOWNERS_FILES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"] as const;
const API_CONTRACT = [
  "**/openapi*.yml",
  "**/openapi*.yaml",
  "**/openapi*.json",
  "**/*.proto",
  "**/api/contract*/**",
  "**/schema.graphql",
];
const MIGRATIONS = ["**/migrations/**", "**/migrate/**", "**/*.sql"];
const I18N = ["**/locales/**", "**/i18n/**", "**/lang/**", "**/translations/**"];

export interface Acceptance {
  readonly by: string;
  readonly at: string;
  readonly reason: string;
}

export interface BodyInput {
  readonly userBody: string;
  readonly base: string;
  readonly baseSha: string;
  readonly files: readonly ChangedFile[];
  readonly scope: ScopeCheck;
  readonly append: readonly string[];
  readonly accepted: Acceptance | undefined;
  readonly snapshots: readonly string[];
  readonly mergeSummary: string | undefined;
}

const ownerPattern = (pattern: string): string => {
  const anchored = pattern.startsWith("/") ? pattern.slice(1) : pattern.includes("/") ? pattern : `**/${pattern}`;
  return anchored.endsWith("/") ? `${anchored}**` : anchored;
};

export const codeOwners = (runtime: Runtime, root: AbsolutePath): ((path: string) => readonly string[]) => {
  const text = CODEOWNERS_FILES.map((file) => runtime.readText(toAbsolutePath(file, root))).find((read) => read.ok);
  const rules = (text?.ok === true ? text.value : "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [pattern = "", ...owners] = line.split(/\s+/);
      return { pattern: ownerPattern(pattern), owners };
    });
  return (path) =>
    [...rules].reverse().find((rule) => matchesAny(path, [rule.pattern, `${rule.pattern}/**`]))?.owners ?? [];
};

const removedLines = (runtime: Runtime, root: AbsolutePath, base: string, path: string): number =>
  runtime
    .git(["diff", "--unified=0", `${base}..HEAD`, "--", path], root)
    .stdout.split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---")).length;

const box = (done: boolean, text: string): string => `- [${done ? "x" : " "}] ${text}`;

export const checklistLines = (runtime: Runtime, root: AbsolutePath, input: BodyInput): readonly string[] => {
  const owners = codeOwners(runtime, root);
  const paths = input.files.map((file) => file.path);
  const lines: string[] = [];
  for (const path of paths.filter((item) => matchesAny(item, API_CONTRACT))) {
    const who = owners(path);
    lines.push(
      box(false, `API contract changed: ${path}; review by ${who.length === 0 ? "the contract owner" : who.join(" ")}`),
    );
  }
  for (const path of paths.filter((item) => matchesAny(item, MIGRATIONS)))
    lines.push(box(false, `Migration ${path}: how to roll it back is written below`));
  for (const path of paths.filter((item) => matchesAny(item, I18N) && /\.(json|ya?ml|po|properties)$/.test(item))) {
    lines.push(box(false, `i18n file ${path}: new keys exist in every language`));
  }
  for (const path of paths.filter((item) => matchesAny(item, input.append))) {
    const lost = removedLines(runtime, root, input.baseSha, path);
    lines.push(
      box(
        lost === 0,
        `Append-only registry ${path}: ${lost === 0 ? "only additions, checked" : `${String(lost)} lines removed`}`,
      ),
    );
  }
  for (const path of paths.filter((item) => LOCKFILES.has(basename(item))))
    lines.push(box(false, `Lockfile ${path} changed: dependency change reviewed`));
  return lines;
};

const scopeTable = (input: BodyInput): readonly string[] => {
  const accepted =
    input.accepted === undefined
      ? ""
      : ` (accepted by ${input.accepted.by}, ${input.accepted.at}: ${input.accepted.reason})`;
  const declared = input.scope.declared.length === 0 ? "inferred from the diff" : input.scope.declared.join(", ");
  const outside =
    input.scope.outside.length === 0 ? "none" : `${input.scope.outside.map((file) => file.path).join(", ")}${accepted}`;
  return ["| Declared scope | Outside the scope |", "|---|---|", `| ${declared} | ${outside} |`];
};

export const prBody = (runtime: Runtime, root: AbsolutePath, input: BodyInput): string => {
  const checklist = checklistLines(runtime, root, input);
  return [
    ...(input.userBody.trim() === "" ? [] : [input.userBody.trim(), ""]),
    "## Scope",
    "",
    ...scopeTable(input),
    "",
    ...(checklist.length === 0 ? [] : ["## Checklist", "", ...checklist, ""]),
    "## Safety snapshots",
    "",
    ...input.snapshots.map((ref) => `- \`${ref}\``),
    `- Base when opened: \`${input.base}@${input.baseSha.slice(0, 12)}\``,
    ...(input.mergeSummary === undefined ? [] : ["", input.mergeSummary]),
    "",
  ].join("\n");
};
