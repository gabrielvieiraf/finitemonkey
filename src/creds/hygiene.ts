import type { AbsolutePath } from "../core/brand.js";
import { publicSecretName } from "./classify.js";
import { envFiles, envNames, isEnvTemplate } from "./env-files.js";
import type { CredsRuntime } from "./files.js";
import { envReads } from "./reads.js";

export type HygieneProblem =
  | { readonly kind: "unignored"; readonly file: string }
  | { readonly kind: "public"; readonly name: string; readonly where: string }
  | { readonly kind: "undocumented"; readonly name: string; readonly where: string }
  | { readonly kind: "unused"; readonly name: string; readonly file: string };

const BUILTIN = new Set([
  "NODE_ENV",
  "CI",
  "PATH",
  "HOME",
  "USER",
  "PWD",
  "SHELL",
  "TZ",
  "LANG",
  "TERM",
  "DEBUG",
  "HOSTNAME",
  "TMPDIR",
  "MODE",
  "DEV",
  "PROD",
  "SSR",
  "BASE_URL",
  "GITHUB_TOKEN",
]);
const BUILTIN_PREFIX = /^(?:GITHUB_|RUNNER_|VERCEL_|NETLIFY|npm_|CLAUDE_|FINITEMONKEY_)/;

export const isBuiltinName = (name: string): boolean => BUILTIN.has(name) || BUILTIN_PREFIX.test(name);

const unignored = (runtime: CredsRuntime, root: AbsolutePath, files: readonly string[]): readonly HygieneProblem[] =>
  files
    .filter((file) => !isEnvTemplate(file))
    .filter((file) => {
      const result = runtime.git(["check-ignore", "-q", "--", file], root);
      return result.found && !result.ok;
    })
    .map((file) => ({ kind: "unignored", file }));

export interface HygieneOptions {
  readonly full: boolean;
}

export const envHygiene = (
  runtime: CredsRuntime,
  root: AbsolutePath,
  options: HygieneOptions = { full: true },
): readonly HygieneProblem[] => {
  const files = envFiles(runtime, root);
  const reads = options.full ? envReads(runtime, root).filter((read) => read.kind === "code") : [];
  const fromFiles = files.flatMap((file) => envNames(runtime, root, file).map((name) => ({ name, where: file })));
  const fromCode = reads.map((read) => ({ name: read.name, where: `${read.file}:${String(read.line)}` }));
  const seenPublic = new Set<string>();
  const publicProblems: HygieneProblem[] = [];
  for (const item of [...fromCode, ...fromFiles]) {
    if (!publicSecretName(item.name) || seenPublic.has(item.name)) continue;
    seenPublic.add(item.name);
    publicProblems.push({ kind: "public", name: item.name, where: item.where });
  }
  const template = files.find((file) => file.split("/").length === 1 && isEnvTemplate(file));
  const parity: HygieneProblem[] = [];
  if (options.full && template !== undefined) {
    const documented = new Set(envNames(runtime, root, template));
    const read = new Set(reads.map((item) => item.name));
    const missing = new Map<string, string>();
    for (const item of fromCode)
      if (!documented.has(item.name) && !isBuiltinName(item.name) && !missing.has(item.name))
        missing.set(item.name, item.where);
    for (const [name, where] of missing) parity.push({ kind: "undocumented", name, where });
    for (const name of documented) if (!read.has(name)) parity.push({ kind: "unused", name, file: template });
  }
  return [...unignored(runtime, root, files), ...publicProblems, ...parity];
};

export const isBlockingHygiene = (problem: HygieneProblem): boolean =>
  problem.kind === "unignored" || problem.kind === "public";
