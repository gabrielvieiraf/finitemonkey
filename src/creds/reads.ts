import type { AbsolutePath } from "../core/brand.js";
import { type CredsRuntime, readRepoFile, repoFiles } from "./files.js";

export interface EnvRead {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly kind: "code" | "workflow";
}

const NAME = String.raw`([A-Za-z_][A-Za-z0-9_]*)`;
const QUOTED = String.raw`["'\x60]${NAME}["'\x60]`;

const CODE_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\bprocess\.env\.${NAME}`, "g"),
  new RegExp(String.raw`\bprocess\.env\[\s*${QUOTED}\s*\]`, "g"),
  new RegExp(String.raw`\bimport\.meta\.env\.${NAME}`, "g"),
  new RegExp(String.raw`\bDeno\.env\.get\(\s*${QUOTED}`, "g"),
  new RegExp(String.raw`\bBun\.env\.${NAME}`, "g"),
  new RegExp(String.raw`\bos\.environ\[\s*${QUOTED}\s*\]`, "g"),
  new RegExp(String.raw`\bos\.(?:environ\.get|getenv)\(\s*${QUOTED}`, "g"),
  new RegExp(String.raw`\bos\.(?:Getenv|LookupEnv)\(\s*${QUOTED}`, "g"),
  new RegExp(String.raw`\bENV(?:\.fetch\(|\[)\s*${QUOTED}`, "g"),
];

const DESTRUCTURED = /\{([^{}]*)\}\s*=\s*process\.env\b/g;
const WORKFLOW_SECRET = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rb|vue|svelte|astro)$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const matches = (pattern: RegExp, text: string): readonly { readonly name: string; readonly index: number }[] =>
  [...text.matchAll(pattern)].map((match) => ({ name: match[1] ?? "", index: match.index }));

const destructured = (text: string): readonly { readonly name: string; readonly index: number }[] =>
  [...text.matchAll(DESTRUCTURED)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((part) => (part.split(":")[0] ?? "").split("=")[0]?.trim() ?? "")
      .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      .map((name) => ({ name, index: match.index })),
  );

export const readsIn = (file: string, text: string): readonly EnvRead[] => {
  if (WORKFLOW.test(file))
    return matches(WORKFLOW_SECRET, text).map((found) => ({
      name: found.name,
      file,
      line: lineAt(text, found.index),
      kind: "workflow",
    }));
  if (!SOURCE.test(file)) return [];
  return [...CODE_PATTERNS.flatMap((pattern) => matches(pattern, text)), ...destructured(text)]
    .map((found) => ({ name: found.name, file, line: lineAt(text, found.index), kind: "code" as const }))
    .sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));
};

export const envReads = (runtime: CredsRuntime, root: AbsolutePath): readonly EnvRead[] =>
  repoFiles(runtime, root).flatMap((file) =>
    SOURCE.test(file) || WORKFLOW.test(file) ? readsIn(file, readRepoFile(runtime, root, file) ?? "") : [],
  );
