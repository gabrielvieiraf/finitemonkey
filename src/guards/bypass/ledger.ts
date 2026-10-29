import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { isRecord, optionalString, parseJsonObject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { logEvent } from "../../evidence/log.js";
import { projectPaths } from "../../gate/hooks/common.js";
import { toolInput, toolName } from "../../hooks/fields.js";
import type { HookHandler, HookInput } from "../../hooks/handlers.js";
import { maskText } from "../../mask/mask.js";
import type { FmPaths } from "../../task/paths.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";

export const DENIED_FILE = "denied.json";
export const BYPASSES_FILE = "bypasses.jsonl";
export const MAX_DENIED = 200;
const SUMMARY_LIMIT = 200;

export interface Bypass {
  readonly id: string;
  readonly tool: string;
  readonly summary: string;
  readonly at: string;
  readonly session: string | null;
  readonly reviewed: boolean;
}

interface Denied {
  readonly id: string;
  readonly tool: string;
  readonly summary: string;
}

export const bypassesFile = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, BYPASSES_FILE));

const idOf = (input: HookInput): string | undefined => {
  const id = optionalString(input.payload.raw, "tool_use_id");
  return id !== undefined && /^[A-Za-z0-9_-]{1,120}$/.test(id) ? id : undefined;
};

const summaryOf = (input: HookInput): string => {
  const args = toolInput(input.payload.raw);
  const text = optionalString(args, "command") ?? optionalString(args, "file_path") ?? JSON.stringify(args);
  return maskText(text).slice(0, SUMMARY_LIMIT);
};

const readDenied = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Denied[] => {
  const list = readJsonFile(runtime, paths.cache(DENIED_FILE))?.["calls"];
  return Array.isArray(list)
    ? list.filter(isRecord).flatMap((item) => {
        const { id, tool, summary } = item;
        return typeof id === "string" && typeof tool === "string" && typeof summary === "string"
          ? [{ id, tool, summary }]
          : [];
      })
    : [];
};

export const noteDenied = (input: HookInput): void => {
  const id = idOf(input);
  const paths = projectPaths(input);
  if (id === undefined || paths === undefined) return;
  const calls = [
    ...readDenied(input.runtime, paths).filter((item) => item.id !== id),
    {
      id,
      tool: toolName(input.payload.raw),
      summary: summaryOf(input),
    },
  ];
  writeJsonFile(input.runtime, paths.cache(DENIED_FILE), { calls: calls.slice(-MAX_DENIED) });
};

const parseBypass = (line: string): Bypass | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok) return undefined;
  const { id, tool, summary, at, session, reviewed } = parsed.value;
  if (typeof id !== "string" || typeof tool !== "string" || typeof summary !== "string" || typeof at !== "string")
    return undefined;
  return { id, tool, summary, at, session: typeof session === "string" ? session : null, reviewed: reviewed === true };
};

export const readBypasses = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Bypass[] => {
  const text = runtime.readText(bypassesFile(paths));
  if (!text.ok) return [];
  const latest = new Map<string, Bypass>();
  for (const line of text.value.split("\n")) {
    const entry = line.trim() === "" ? undefined : parseBypass(line);
    if (entry !== undefined) latest.set(entry.id, entry);
  }
  return [...latest.values()];
};

export const unreviewedBypasses = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly Bypass[] =>
  readBypasses(runtime, paths).filter((entry) => !entry.reviewed);

export const appendBypass = (runtime: Pick<Runtime, "appendText">, paths: FmPaths, entry: Bypass): boolean =>
  runtime.appendText(bypassesFile(paths), `${JSON.stringify(entry)}\n`).ok;

export const detectBypass: HookHandler = (input) => {
  const id = idOf(input);
  const paths = projectPaths(input);
  if (id === undefined || paths === undefined) return { kind: "allow" };
  const denied = readDenied(input.runtime, paths);
  const found = denied.find((item) => item.id === id);
  if (found === undefined) return { kind: "allow" };
  writeJsonFile(input.runtime, paths.cache(DENIED_FILE), { calls: denied.filter((item) => item.id !== id) });
  const entry: Bypass = {
    id,
    tool: found.tool,
    summary: found.summary,
    at: input.runtime.now(),
    session: input.payload.sessionId ?? null,
    reviewed: false,
  };
  appendBypass(input.runtime, paths, entry);
  logEvent(input.runtime, paths, "guard_bypassed", { id, tool: found.tool, summary: found.summary });
  return {
    kind: "block",
    reason: input.t("bypass.detected", { tool: found.tool, summary: found.summary }),
    human: input.t("bypass.detected.human", { tool: found.tool }),
  };
};
