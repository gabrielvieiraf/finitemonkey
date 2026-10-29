import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { projectLogDir } from "../history/look-back.js";
import { isCorrection } from "../premise/detect.js";

export const READ_TOOLS: ReadonlySet<string> = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "MultiEdit", "NotebookEdit"]);
export const WHOLE_TOOLS: ReadonlySet<string> = new Set(["Write"]);
export const LARGE_FILES = 4;

export interface SessionStats {
  readonly day: string;
  readonly model: string;
  readonly version: string;
  readonly reads: number;
  readonly edits: number;
  readonly writes: number;
  readonly corrections: number;
  readonly files: number;
}

interface Draft {
  day: string;
  models: Map<string, number>;
  versions: Map<string, number>;
  reads: number;
  edits: number;
  writes: number;
  corrections: number;
  files: Set<string>;
}

const bump = (counts: Map<string, number>, key: string): void => {
  if (key !== "") counts.set(key, (counts.get(key) ?? 0) + 1);
};

export const majority = (counts: ReadonlyMap<string, number>): string =>
  [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "unknown";

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) =>
      isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? block["text"] : "",
    )
    .join("\n");
};

const addTool = (draft: Draft, block: unknown): void => {
  if (!isRecord(block) || block["type"] !== "tool_use" || typeof block["name"] !== "string") return;
  const name = block["name"];
  const input = isRecord(block["input"]) ? block["input"] : {};
  const file = typeof input["file_path"] === "string" ? input["file_path"] : "";
  if (READ_TOOLS.has(name)) draft.reads += 1;
  if (EDIT_TOOLS.has(name)) draft.edits += 1;
  if (WHOLE_TOOLS.has(name)) draft.writes += 1;
  if ((EDIT_TOOLS.has(name) || WHOLE_TOOLS.has(name)) && file !== "") draft.files.add(file);
};

const addLine = (draft: Draft, line: string): void => {
  const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
  if (parsed?.ok !== true) return;
  const entry = parsed.value;
  const message = isRecord(entry["message"]) ? entry["message"] : {};
  if (draft.day === "" && typeof entry["timestamp"] === "string") draft.day = entry["timestamp"].slice(0, 10);
  if (typeof entry["version"] === "string") bump(draft.versions, entry["version"]);
  if (entry["type"] === "user" && isCorrection(textOf(message["content"]))) draft.corrections += 1;
  if (entry["type"] !== "assistant") return;
  if (typeof message["model"] === "string") bump(draft.models, message["model"]);
  const content = message["content"];
  if (Array.isArray(content)) for (const block of content as readonly unknown[]) addTool(draft, block);
};

export const sessionStats = (text: string): SessionStats | undefined => {
  const draft: Draft = {
    day: "",
    models: new Map(),
    versions: new Map(),
    reads: 0,
    edits: 0,
    writes: 0,
    corrections: 0,
    files: new Set(),
  };
  for (const line of text.split("\n")) addLine(draft, line);
  if (draft.day === "") return undefined;
  return {
    day: draft.day,
    model: majority(draft.models),
    version: majority(draft.versions),
    reads: draft.reads,
    edits: draft.edits,
    writes: draft.writes,
    corrections: draft.corrections,
    files: draft.files.size,
  };
};

export const classOf = (stats: Pick<SessionStats, "files">): "small" | "large" =>
  stats.files >= LARGE_FILES ? "large" : "small";

export const collectSessions = (
  runtime: Pick<Runtime, "homeDir" | "listDir" | "readText">,
  root: string,
  env: Env,
): readonly SessionStats[] => {
  const dir = projectLogDir(runtime, root, env);
  const listed = runtime.listDir(toAbsolutePath(dir));
  const files = listed.ok ? listed.value.filter((name) => name.endsWith(".jsonl")).sort() : [];
  return files.flatMap((name) => {
    const text = runtime.readText(toAbsolutePath(join(dir, name)));
    return text.ok ? (sessionStats(text.value) ?? []) : [];
  });
};
