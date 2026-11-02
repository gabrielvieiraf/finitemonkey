import { globToRegExp } from "../../core/glob.js";
import { configList, type ConfigTree } from "../../git/project-config.js";
import {
  CATALOG,
  type CatalogEntry,
  hasDestroyVerb,
  hasWriteVerb,
  methodOf,
  type RemoteCall,
  type RemoteEffect,
} from "./catalog.js";
import { scriptFileCall, type ScriptReader } from "./script-file.js";

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
  if (call.tool.startsWith("mcp__") && hasWriteVerb(methodOf(call.tool))) {
    return { effect: "write", entry: "write-verb", target: call.tool, heuristic: true };
  }
  return UNKNOWN;
};

const NO_READER: ScriptReader = () => undefined;

export const classifyWithScripts = (
  call: RemoteCall,
  extension: RemoteExtension = NO_EXTENSION,
  read: ScriptReader = NO_READER,
): Classification => {
  const found = classifyCall(call, extension);
  if (found.effect !== "unknown") return found;
  const script = scriptFileCall(call, read);
  if (script === undefined) return found;
  const entry = script.effect === "destroy" ? "script-file-delete" : "script-file-write";
  return { effect: script.effect, entry, target: script.target, heuristic: false };
};
