import type { SignalEntry } from "./store.js";

export interface AgentWrite {
  readonly file: string;
  readonly via: "tool" | "shell";
  readonly lines?: readonly string[];
}

const linesOf = (lines: readonly string[] | undefined): { readonly lines?: readonly string[] } =>
  lines === undefined ? {} : { lines };

export const agentWrites = (entries: readonly SignalEntry[]): readonly AgentWrite[] =>
  entries.flatMap((entry): readonly AgentWrite[] => {
    if (entry.kind !== "edit" && entry.kind !== "bash_write") return [];
    if (entry.file === "") return [];
    return [{ file: entry.file, via: entry.kind === "edit" ? "tool" : "shell", ...linesOf(entry.lines) }];
  });
