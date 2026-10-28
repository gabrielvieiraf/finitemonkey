import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { projectLogDir } from "../history/look-back.js";
import type { FmPaths } from "../task/paths.js";
import { isPersonText, type PersonRequest } from "./log.js";

const textOf = (content: unknown): string | undefined => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const blocks = content.filter(isRecord);
  if (blocks.some((block) => block["type"] === "tool_result")) return undefined;
  return blocks
    .filter((block) => block["type"] === "text" && typeof block["text"] === "string")
    .map((block) => String(block["text"]))
    .join("\n");
};

const requestOf = (line: string, session: string): PersonRequest | undefined => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok) return undefined;
  const record = parsed.value;
  if (record["type"] !== "user" || record["isSidechain"] === true || record["isMeta"] === true) return undefined;
  if (typeof record["sessionId"] === "string" && record["sessionId"] !== session) return undefined;
  const message = record["message"];
  const text = isRecord(message) ? textOf(message["content"]) : undefined;
  const at = typeof record["timestamp"] === "string" ? record["timestamp"] : "";
  return text === undefined || !isPersonText(text) ? undefined : { at, session, text };
};

export const transcriptRequests = (
  runtime: Pick<Runtime, "homeDir" | "listDir" | "readText">,
  paths: FmPaths,
  env: Env,
): readonly PersonRequest[] => {
  const dir = projectLogDir(runtime, paths.root, env);
  const names = runtime.listDir(toAbsolutePath(dir));
  return (names.ok ? names.value : [])
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => {
      const text = runtime.readText(toAbsolutePath(join(dir, name)));
      const session = name.replace(/\.jsonl$/, "");
      return text.ok ? text.value.split("\n").flatMap((line) => requestOf(line, session) ?? []) : [];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
};
