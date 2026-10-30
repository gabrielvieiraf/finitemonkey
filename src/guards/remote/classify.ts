import { globToRegExp } from "../../core/glob.js";
import { configList, type ConfigTree } from "../../git/project-config.js";
import { CATALOG, type CatalogEntry, hasDestroyVerb, methodOf, type RemoteCall, type RemoteEffect } from "./catalog.js";

export interface Classification {
  readonly effect: RemoteEffect | "unknown";
  readonly entry: string;
  readonly target: string;
  readonly heuristic: boolean;
}

export interface RemoteExtension {
  readonly destroy: readonly string[];
  readonly read: readonly string[];
}

export const NO_EXTENSION: RemoteExtension = { destroy: [], read: [] };

export const remoteExtension = (config: ConfigTree): RemoteExtension => ({
  destroy: configList(config, "remote", "destroy"),
  read: configList(config, "remote", "read"),
});

const matchesGlob = (tool: string, globs: readonly string[]): boolean =>
  globs.some((glob) => globToRegExp(glob).test(tool));

const UNKNOWN: Classification = { effect: "unknown", entry: "", target: "", heuristic: false };

export const isCandidate = (tool: string): boolean =>
  tool.startsWith("mcp__") || tool === "Bash" || tool === "PowerShell";

export const classifyCall = (
  call: RemoteCall,
  extension: RemoteExtension = NO_EXTENSION,
  catalog: readonly CatalogEntry[] = CATALOG,
): Classification => {
  if (matchesGlob(call.tool, extension.read)) {
    return { effect: "read", entry: "project-read", target: call.tool, heuristic: false };
  }
  if (matchesGlob(call.tool, extension.destroy)) {
    return { effect: "destroy", entry: "project-destroy", target: call.tool, heuristic: false };
  }
  for (const entry of catalog) {
    const target = entry.match(call);
    if (target !== undefined) return { effect: entry.effect, entry: entry.id, target, heuristic: false };
  }
  if (call.tool.startsWith("mcp__") && hasDestroyVerb(methodOf(call.tool))) {
    return { effect: "destroy", entry: "destroy-verb", target: call.tool, heuristic: true };
  }
  return UNKNOWN;
};
