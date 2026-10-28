import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export type CredsRuntime = Pick<Runtime, "git" | "listDir" | "readText">;

const SKIPPED = new Set(["node_modules", "dist", "build", "vendor", ".git", ".finitemonkey", "coverage"]);

export const repoFiles = (runtime: CredsRuntime, root: AbsolutePath): readonly string[] => {
  const tracked = runtime.git(["ls-files", "--cached", "--others", "--exclude-standard"], root);
  const files =
    tracked.found && tracked.ok
      ? tracked.stdout.split("\n").filter((line) => line !== "")
      : (() => {
          const entries = runtime.listDir(root);
          return entries.ok ? entries.value : [];
        })();
  return files.filter((file) => !file.split("/").some((part) => SKIPPED.has(part)));
};

export const readRepoFile = (runtime: CredsRuntime, root: AbsolutePath, file: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(file, root));
  return text.ok ? text.value : undefined;
};

export const baseName = (file: string): string => file.slice(file.lastIndexOf("/") + 1);
