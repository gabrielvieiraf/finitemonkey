import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { detectPatterns, isDeployContext, wantsText } from "./detect.js";
import { aliasHosts, findHosts } from "./hosts.js";
import { findRisks } from "./risks.js";
import { buildTargets, detectLevel, findConflicts } from "./targets.js";
import type { HostEntry, Inventory, SourceFile } from "./types.js";

export const MAX_FILES = 20_000;
export const MAX_READ = 400;
export const MAX_BYTES = 256 * 1024;
const SKIP = /(^|\/)(node_modules|vendor|dist|build|\.git|\.finitemonkey)\//;

export const listProjectFiles = (runtime: Pick<Runtime, "git">, root: AbsolutePath): readonly string[] => {
  const listed = runtime.git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
  if (!listed.ok) return [];
  return listed.stdout
    .split("\0")
    .filter((path) => path !== "" && !SKIP.test(path))
    .slice(0, MAX_FILES);
};

export const readSources = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  paths: readonly string[],
): readonly SourceFile[] =>
  paths
    .filter(wantsText)
    .slice(0, MAX_READ)
    .flatMap((path) => {
      const text = runtime.readText(toAbsolutePath(join(root, path)));
      return text.ok && text.value.length <= MAX_BYTES ? [{ path, text: text.value.replace(/\r\n/g, "\n") }] : [];
    });

export const inventoryOf = (
  files: readonly SourceFile[],
  paths: readonly string[],
  known: readonly HostEntry[] = [],
): Inventory => {
  const hits = detectPatterns(files, paths);
  const deploy = files.filter((file) => isDeployContext(file, hits));
  const hosts = aliasHosts(findHosts(deploy), known);
  const risks = findRisks(files, hits);
  const targets = buildTargets(files, hits, risks, hosts);
  return { level: detectLevel(hits, hosts), hits, targets, risks, conflicts: findConflicts(targets), hosts };
};

export const scanInfra = (runtime: Runtime, root: AbsolutePath, known: readonly HostEntry[] = []): Inventory => {
  const paths = listProjectFiles(runtime, root);
  return inventoryOf(readSources(runtime, root, paths), paths, known);
};
