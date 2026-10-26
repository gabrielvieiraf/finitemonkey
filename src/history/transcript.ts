import { isRecord, parseJsonObject } from "../core/parsed.js";

export interface ToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResult {
  readonly failed: boolean;
  readonly text: string;
}

export interface Turn {
  readonly prompt: string;
  readonly tools: readonly ToolUse[];
  readonly results: ReadonlyMap<string, ToolResult>;
  readonly finalText: string;
}

interface Draft {
  prompt: string;
  tools: ToolUse[];
  results: Map<string, ToolResult>;
  finalText: string;
}

const blocksOf = (message: unknown): readonly unknown[] => {
  if (!isRecord(message)) return [];
  const content = message["content"];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as readonly unknown[]) : [];
};

const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return (value as readonly unknown[]).map(textOf).join("\n");
  return isRecord(value) && typeof value["text"] === "string" ? value["text"] : "";
};

const FAILED_EXIT = /^Exit code [1-9]\d*/m;

const startTurn = (prompt: string): Draft => ({ prompt, tools: [], results: new Map(), finalText: "" });

const addAssistant = (draft: Draft, blocks: readonly unknown[]): void => {
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block["type"] === "text" && typeof block["text"] === "string" && block["text"].trim() !== "") {
      draft.finalText = block["text"];
    }
    const { id, name, input } = block;
    if (block["type"] === "tool_use" && typeof id === "string" && typeof name === "string" && isRecord(input)) {
      draft.tools.push({ id, name, input });
    }
  }
};

const addResults = (draft: Draft, blocks: readonly unknown[]): boolean => {
  let any = false;
  for (const block of blocks) {
    if (!isRecord(block) || block["type"] !== "tool_result" || typeof block["tool_use_id"] !== "string") continue;
    const text = textOf(block["content"]);
    draft.results.set(block["tool_use_id"], { failed: block["is_error"] === true || FAILED_EXIT.test(text), text });
    any = true;
  }
  return any;
};

export const parseTranscript = (jsonl: string): readonly Turn[] => {
  const turns: Draft[] = [];
  let current: Draft | undefined;
  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const parsed = parseJsonObject(line);
    if (!parsed.ok) continue;
    const entry = parsed.value;
    const blocks = blocksOf(entry["message"]);
    if (entry["type"] === "user") {
      if (current !== undefined && addResults(current, blocks)) continue;
      const prompt = blocks.map(textOf).join("\n").trim();
      if (prompt === "") continue;
      current = startTurn(prompt);
      turns.push(current);
    } else if (entry["type"] === "assistant" && current !== undefined) {
      addAssistant(current, blocks);
    }
  }
  return turns;
};
