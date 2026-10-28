import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export type SupplyRuntime = Pick<Runtime, "git" | "listDir" | "readText">;

const listed = (runtime: SupplyRuntime, root: AbsolutePath, dir: string): readonly string[] => {
  const entries = runtime.listDir(toAbsolutePath(dir === "" ? "." : dir, root));
  return entries.ok ? entries.value.map((name) => (dir === "" ? name : `${dir}/${name}`)) : [];
};

export const projectFiles = (runtime: SupplyRuntime, root: AbsolutePath): readonly string[] => {
  const tracked = runtime.git(["ls-files", "--cached", "--others", "--exclude-standard"], root);
  if (tracked.found && tracked.ok) return tracked.stdout.split("\n").filter((line) => line !== "");
  return [...listed(runtime, root, ""), ...listed(runtime, root, ".github/workflows")];
};

export const readProjectFile = (runtime: SupplyRuntime, root: AbsolutePath, file: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(file, root));
  return text.ok ? text.value : undefined;
};

export const dirOf = (file: string): string => {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? "" : file.slice(0, slash);
};

export const baseOf = (file: string): string => file.slice(file.lastIndexOf("/") + 1);
