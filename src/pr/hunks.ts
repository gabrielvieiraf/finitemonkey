import type { AddedLine } from "../gate/git.js";
import type { AgentWrite } from "../signals/agent-writes.js";
import { lineHash, meaningful } from "../signals/line-hashes.js";

export type LineOrigin = "agent" | "person";

export interface LineRun {
  readonly start: number;
  readonly end: number;
  readonly origin: LineOrigin;
}

export interface FileAttribution {
  readonly origin: "agent" | "unknown";
  readonly edits: number;
  readonly hunks?: readonly LineRun[];
}

export const MAX_RUNS_SHOWN = 8;

const blocksOf = (added: readonly AddedLine[]): readonly (readonly AddedLine[])[] => {
  const sorted = [...added].sort((a, b) => a.line - b.line);
  const blocks: AddedLine[][] = [];
  for (const line of sorted) {
    const last = blocks.at(-1);
    const previous = last?.at(-1);
    if (last !== undefined && previous !== undefined && line.line === previous.line + 1) last.push(line);
    else blocks.push([line]);
  }
  return blocks;
};

const resolveBlock = (block: readonly AddedLine[], agent: ReadonlySet<string>): readonly (LineOrigin | undefined)[] => {
  const own = block.map((line): LineOrigin | undefined =>
    meaningful(line.text) ? (agent.has(lineHash(line.text)) ? "agent" : "person") : undefined,
  );
  const first = own.find((origin) => origin !== undefined);
  let carried = first;
  return own.map((origin) => {
    carried = origin ?? carried;
    return carried;
  });
};

const appendRun = (runs: LineRun[], line: number, origin: LineOrigin): void => {
  const last = runs.at(-1);
  if (last?.origin === origin && last.end === line - 1) runs[runs.length - 1] = { ...last, end: line };
  else runs.push({ start: line, end: line, origin });
};

export const runsOf = (added: readonly AddedLine[], agent: ReadonlySet<string>): readonly LineRun[] => {
  const runs: LineRun[] = [];
  for (const block of blocksOf(added)) {
    const origins = resolveBlock(block, agent);
    block.forEach((line, index) => {
      const origin = origins[index];
      if (origin !== undefined) appendRun(runs, line.line, origin);
    });
  }
  return runs;
};

export const attributeFile = (writes: readonly AgentWrite[], added: readonly AddedLine[]): FileAttribution => {
  if (writes.length === 0) return { origin: "unknown", edits: 0 };
  const base = { origin: "agent", edits: writes.length } as const;
  if (writes.some((write) => write.lines === undefined)) return base;
  const agent = new Set(writes.flatMap((write) => write.lines ?? []));
  const hunks = runsOf(added, agent);
  return hunks.length === 0 ? base : { ...base, hunks };
};

const runText = (run: LineRun): string =>
  `${run.start === run.end ? String(run.start) : `${String(run.start)}-${String(run.end)}`} ${run.origin}`;

export const hunksText = (hunks: readonly LineRun[]): string => {
  const shown = hunks.slice(0, MAX_RUNS_SHOWN).map(runText);
  const rest = hunks.length - MAX_RUNS_SHOWN;
  return `lines ${[...shown, ...(rest > 0 ? [`${String(rest)} more`] : [])].join(", ")}`;
};
