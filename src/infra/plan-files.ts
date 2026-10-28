import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { lineDiff } from "../install/diff.js";

export type FileAction = "create" | "unchanged" | "differs";

export interface PlannedFile {
  readonly path: string;
  readonly text: string;
  readonly action: FileAction;
  readonly diff: readonly string[];
}

export interface WantedFile {
  readonly path: string;
  readonly text: string;
}

export const planFiles = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  wanted: readonly WantedFile[],
): readonly PlannedFile[] =>
  wanted.map((file) => {
    const current = runtime.readText(toAbsolutePath(join(root, file.path)));
    if (!current.ok) return { ...file, action: "create", diff: lineDiff(file.path, "", file.text) };
    if (current.value.replace(/\r\n/g, "\n") === file.text) return { ...file, action: "unchanged", diff: [] };
    return { ...file, action: "differs", diff: lineDiff(file.path, current.value, file.text) };
  });

export const writePlanned = (
  runtime: Pick<Runtime, "mkdir" | "writeAtomic">,
  root: AbsolutePath,
  planned: readonly PlannedFile[],
  overwrite: boolean,
): { readonly written: readonly string[]; readonly failed: readonly string[] } => {
  const written: string[] = [];
  const failed: string[] = [];
  for (const file of planned) {
    if (file.action === "unchanged" || (file.action === "differs" && !overwrite)) continue;
    const target = toAbsolutePath(join(root, file.path));
    const made = runtime.mkdir(toAbsolutePath(dirname(target)));
    const saved = made.ok ? runtime.writeAtomic(target, file.text) : made;
    (saved.ok ? written : failed).push(file.path);
  }
  return { written, failed };
};

const FORMAT_TIMEOUT_MS = 20_000;
const PRETTIER = /\.(?:ya?ml|json|md)$/;

export const projectFormat =
  (runtime: Pick<Runtime, "stat" | "exec">, root: AbsolutePath) =>
  (path: string, text: string): string => {
    const bin = toAbsolutePath(join(root, "node_modules", "prettier", "bin", "prettier.cjs"));
    if (!PRETTIER.test(path) || runtime.stat(bin) === undefined) return text;
    const result = runtime.exec({
      command: process.execPath,
      args: [bin, "--stdin-filepath", path],
      cwd: root,
      timeoutMs: FORMAT_TIMEOUT_MS,
      input: text,
    });
    return result.exitCode === 0 && result.stdout !== "" ? result.stdout : text;
  };
