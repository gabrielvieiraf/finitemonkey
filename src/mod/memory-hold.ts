import { isRecord } from "../core/parsed.js";
import { editsOf, textField } from "../hooks/fields.js";
import { instructionLines, isNativeMemory } from "../knowledge/instruction.js";
import { readsUntrusted } from "../policy/untrusted.js";
import type { LoadedState, TightenMode } from "./state.js";

export const MEMORY_HOLD_RULE = "memory.untrusted";
export const MEMORY_HOLD_REASON =
  "finitemonkey: this session read untrusted content, and this write to native memory carries an instruction-shaped line. Memory keeps facts, not orders; ask the person to write it if it is theirs.";

const WRITERS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

export interface MemoryHold {
  readonly mode: TightenMode;
  readonly reason: string;
}

const written = (input: Readonly<Record<string, unknown>>): string =>
  textField(input, "content") ??
  editsOf(input)
    .map((edit) => edit.newText)
    .join("\n");

export const untrustedSeen = (tool: string, before: string | undefined): string | undefined =>
  readsUntrusted(tool) ? tool : before;

export const memoryHold = (
  state: LoadedState | undefined,
  tool: string,
  input: unknown,
  seen: string | undefined,
): MemoryHold | undefined => {
  if (!WRITERS.has(tool) || !isRecord(input)) return undefined;
  if (!isNativeMemory(textField(input, "file_path") ?? "")) return undefined;
  const hold = state?.memory;
  if (hold?.mode === "off") return undefined;
  const source = seen ?? hold?.untrusted ?? undefined;
  if (source === undefined || instructionLines(written(input)).length === 0) return undefined;
  return { mode: hold?.mode ?? "active", reason: hold?.reason ?? MEMORY_HOLD_REASON };
};
