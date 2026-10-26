import type { Runner } from "../install/hook-entries.js";
import { BLOCK_BEGIN, BLOCK_END } from "../install/layout.js";
import { type Markers, withManagedBlock, withoutManagedBlock } from "../install/managed-block.js";
import type { PlanItem } from "../install/plan.js";
import type { Project } from "../install/project.js";
import { cliCommand } from "../install/skill-template.js";

export const HOOK_MARKERS: Markers = { begin: BLOCK_BEGIN, end: BLOCK_END };

export const GIT_HOOK_NAMES = ["pre-commit", "commit-msg", "pre-push"] as const;

export type GitHookName = (typeof GIT_HOOK_NAMES)[number];

export const LEFTHOOK_FILES = ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml"] as const;
export const PRE_COMMIT_FILE = ".pre-commit-config.yaml";

const HOOK_ARGS: Readonly<Record<GitHookName, string>> = {
  "pre-commit": "secrets scan --staged",
  "commit-msg": 'commit-msg "$1"',
  "pre-push": 'push check "$1"',
};

const item = (path: string, before: string | undefined, after: string, proposal?: string): PlanItem => {
  const base = { path, kind: "githook" as const, before };
  if (proposal !== undefined) return { ...base, action: "skip-foreign", after: before ?? "", proposal };
  if (before === undefined) return { ...base, action: "create", after };
  return { ...base, action: before === after ? "unchanged" : "merge", after };
};

const huskyItems = (project: Project, runner: Runner): readonly PlanItem[] =>
  GIT_HOOK_NAMES.map((hook) => {
    const path = `.husky/${hook}`;
    const before = project.read(path);
    return item(path, before, withManagedBlock(before, HOOK_MARKERS, [cliCommand(runner, HOOK_ARGS[hook])]));
  });

const lefthookBody = (runner: Runner): readonly string[] => [
  "pre-commit:",
  "  commands:",
  "    finitemonkey-secrets:",
  `      run: ${cliCommand(runner, "secrets scan --staged")}`,
  "commit-msg:",
  "  commands:",
  "    finitemonkey-commit-msg:",
  `      run: ${cliCommand(runner, "commit-msg {1}")}`,
  "pre-push:",
  "  commands:",
  "    finitemonkey-push:",
  `      run: ${cliCommand(runner, "push check {1}")}`,
  "      use_stdin: true",
];

const definesHook = (text: string): boolean =>
  GIT_HOOK_NAMES.some((hook) => new RegExp(`^${hook}:`, "m").test(withoutManagedBlock(text, HOOK_MARKERS)));

const lefthookItem = (project: Project, runner: Runner, path: string): PlanItem => {
  const before = project.read(path);
  const after = withManagedBlock(before, HOOK_MARKERS, lefthookBody(runner));
  return before !== undefined && definesHook(before) ? item(path, before, after, after) : item(path, before, after);
};

const preCommitBody = (runner: Runner, indent: string): readonly string[] => {
  const hook = (id: string, args: string, stage: string): readonly string[] => [
    `${indent}    - id: ${id}`,
    `${indent}      name: ${id}`,
    `${indent}      entry: ${cliCommand(runner, args)}`,
    `${indent}      language: system`,
    `${indent}      pass_filenames: ${stage === "commit-msg" ? "true" : "false"}`,
    `${indent}      always_run: true`,
    `${indent}      stages: [${stage}]`,
  ];
  return [
    `${indent}- repo: local`,
    `${indent}  hooks:`,
    ...hook("finitemonkey-secrets", "secrets scan --staged", "pre-commit"),
    ...hook("finitemonkey-commit-msg", "commit-msg", "commit-msg"),
    ...hook("finitemonkey-push", "push check", "pre-push"),
  ];
};

const TOP_KEY = /^[A-Za-z_][\w-]*:/;

const reposIsLast = (text: string): boolean => {
  const keys = withoutManagedBlock(text, HOOK_MARKERS)
    .split(/\r?\n/)
    .filter((line) => TOP_KEY.test(line));
  return keys.at(-1)?.startsWith("repos:") === true;
};

const preCommitItem = (project: Project, runner: Runner): PlanItem => {
  const before = project.read(PRE_COMMIT_FILE) ?? "";
  const indent = /^( *)- repo:/m.exec(before)?.[1] ?? "  ";
  const after = withManagedBlock(before, HOOK_MARKERS, preCommitBody(runner, indent));
  return reposIsLast(before) ? item(PRE_COMMIT_FILE, before, after) : item(PRE_COMMIT_FILE, before, after, after);
};

const usesHusky = (project: Project): boolean => {
  if (project.isDir(".husky")) return true;
  return /"husky"\s*:/.test(project.read("package.json") ?? "");
};

export const gitHookItems = (project: Project, runner: Runner): readonly PlanItem[] => {
  const lefthook = LEFTHOOK_FILES.find((path) => project.exists(path));
  return [
    ...(usesHusky(project) ? huskyItems(project, runner) : []),
    ...(lefthook === undefined ? [] : [lefthookItem(project, runner, lefthook)]),
    ...(project.exists(PRE_COMMIT_FILE) ? [preCommitItem(project, runner)] : []),
  ];
};
