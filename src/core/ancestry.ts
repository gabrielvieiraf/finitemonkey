import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { AncestorInfo } from "./runtime.js";

const MAX_DEPTH = 64;
const PS_TIMEOUT_MS = 3000;

export interface ProcessRow {
  readonly ppid: number;
  readonly command: string;
}

export type ProcessLookup = (pid: number) => ProcessRow | undefined;

export const parseProcStat = (stat: string): number | undefined => {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) ? ppid : undefined;
};

export const parsePsTable = (stdout: string): ReadonlyMap<number, ProcessRow> => {
  const rows = new Map<number, ProcessRow>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match !== null) rows.set(Number(match[1]), { ppid: Number(match[2]), command: (match[3] ?? "").trim() });
  }
  return rows;
};

export const walkAncestors = (start: number, lookup: ProcessLookup): readonly AncestorInfo[] => {
  const found: AncestorInfo[] = [];
  const seen = new Set<number>();
  let pid = start;
  while (pid > 1 && !seen.has(pid) && found.length < MAX_DEPTH) {
    seen.add(pid);
    const row = lookup(pid);
    if (row === undefined) break;
    found.push({ pid, command: row.command });
    pid = row.ppid;
  }
  return found;
};

const linuxRow: ProcessLookup = (pid) => {
  try {
    const ppid = parseProcStat(readFileSync(`/proc/${String(pid)}/stat`, "utf8"));
    const command = readFileSync(`/proc/${String(pid)}/cmdline`, "utf8")
      .split("\0")
      .join(" ")
      .trim();
    return ppid === undefined ? undefined : { ppid, command };
  } catch {
    return undefined;
  }
};

const psTable = (): ReadonlyMap<number, ProcessRow> => {
  try {
    const stdout = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
      encoding: "utf8",
      timeout: PS_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parsePsTable(stdout);
  } catch {
    return new Map();
  }
};

export const nodeAncestors = (): readonly AncestorInfo[] => {
  if (process.platform === "linux") return walkAncestors(process.ppid, linuxRow);
  if (process.platform === "darwin") {
    const table = psTable();
    return walkAncestors(process.ppid, (pid) => table.get(pid));
  }
  return [];
};

export type AncestorSource = () => readonly AncestorInfo[];

let source: AncestorSource = nodeAncestors;

export const useAncestorSource = (next: AncestorSource): void => {
  source = next;
};

export const currentAncestors = (): readonly AncestorInfo[] => source();

const CLAUDE_COMMAND =
  /(?:^|[/\\\s])claude(?:\.exe)?(?:\s|$)|@anthropic-ai[/\\]claude-code|claude-code[/\\]cli\.[cm]?js/i;

export const isClaudeCommand = (command: string): boolean => CLAUDE_COMMAND.test(command);

export const claudeAncestor = (ancestors: readonly AncestorInfo[]): AncestorInfo | undefined =>
  ancestors.find((ancestor) => isClaudeCommand(ancestor.command));
