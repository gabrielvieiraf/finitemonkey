import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import { gitAt, treeHash } from "../gate/git.js";
import { readDecisions } from "../guardian/decisions.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { readEntries, signalFiles } from "../signals/store.js";
import { fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";

export const PROVENANCE_START = "<!-- finitemonkey:provenance";
export const PROVENANCE_END = "<!-- finitemonkey:provenance:end -->";
export const MAX_BLOCK_LINES = 60;

export interface GeneratedFile {
  readonly path: string;
  readonly origin: "agent" | "unknown";
  readonly edits: number;
}

export interface VerifiedCheck {
  readonly check: string;
  readonly status: string;
  readonly treeHash: string;
  readonly command: string | null;
  readonly exitCode: number | null;
}

export interface ProvenanceSources {
  readonly task: string | null;
  readonly tree: string | null;
  readonly generated: readonly GeneratedFile[];
  readonly verified: readonly VerifiedCheck[];
  readonly notVerified: readonly VerifiedCheck[];
  readonly decisions: readonly string[];
}

const latestPerCheck = (entries: readonly Evidence[]): readonly Evidence[] => {
  const latest = new Map<string, Evidence>();
  for (const entry of entries) if (entry.check !== GATE_CHECK) latest.set(entry.check, entry);
  return [...latest.values()].sort((a, b) => a.check.localeCompare(b.check));
};

const checkOf = (entry: Evidence): VerifiedCheck => ({
  check: entry.check,
  status: entry.status,
  treeHash: entry.treeHash,
  command: entry.command ?? null,
  exitCode: entry.exitCode ?? null,
});

type SourceRuntime = Pick<Runtime, "readText" | "homeDir" | "exec">;

export const provenanceSources = (
  runtime: SourceRuntime,
  root: AbsolutePath,
  files: readonly string[],
): ProvenanceSources => {
  const paths = fmPaths(root);
  const task = readState(runtime, paths).active ?? null;
  const tree = treeHash(gitAt(runtime, root)) ?? null;
  const edits = readEntries(runtime, signalFiles(paths)).flatMap((entry) =>
    entry.kind === "edit" ? [entry.file] : [],
  );
  const latest = task === null ? [] : latestPerCheck(readLedger(runtime, paths.evidence(task)));
  const current = (entry: Evidence): boolean => entry.status === "passed" && entry.treeHash === tree;
  return {
    task,
    tree,
    generated: [...files].sort().map((path) => {
      const count = edits.filter((file) => file === path).length;
      return { path, origin: count > 0 ? "agent" : "unknown", edits: count };
    }),
    verified: latest.filter(current).map(checkOf),
    notVerified: latest.filter((entry) => !current(entry)).map(checkOf),
    decisions: readDecisions(runtime, paths).flatMap((entry) => entry.overrideReason ?? entry.choice ?? []),
  };
};

const capped = (lines: readonly string[]): readonly string[] =>
  lines.length <= MAX_BLOCK_LINES
    ? lines
    : [...lines.slice(0, MAX_BLOCK_LINES - 1), `- ${String(lines.length - MAX_BLOCK_LINES + 1)} more lines left out`];

const checkLine = (item: VerifiedCheck): string =>
  `- ${item.check}: ${item.status} at tree \`${item.treeHash}\`${item.command === null ? "" : `, \`${item.command}\``}${item.exitCode === null ? "" : `, exit ${String(item.exitCode)}`}`;

export const sourcesHash = (sources: ProvenanceSources): string => sha256Hex(JSON.stringify(sources)).slice(0, 32);

export const renderBlock = (sources: ProvenanceSources): string => {
  const body = [
    "## Provenance",
    "",
    `Task: ${sources.task ?? "none"} · tree \`${sources.tree ?? "unknown"}\``,
    "",
    "### Generated",
    ...sources.generated.map((file) =>
      file.origin === "agent" ? `- ${file.path}: agent edits (${String(file.edits)})` : `- ${file.path}: unknown`,
    ),
    "",
    "### Verified",
    ...(sources.verified.length === 0 ? ["- none"] : sources.verified.map(checkLine)),
    "",
    "### Not verified",
    ...(sources.notVerified.length === 0 ? ["- none"] : sources.notVerified.map(checkLine)),
    ...(sources.decisions.length === 0 ? [] : ["", "### Decisions", ...sources.decisions.map((text) => `- ${text}`)]),
  ];
  return [`${PROVENANCE_START} sha256=${sourcesHash(sources)} -->`, ...capped(body), PROVENANCE_END].join("\n");
};

export const extractBlock = (body: string): string | undefined => {
  const start = body.indexOf(PROVENANCE_START);
  const end = body.indexOf(PROVENANCE_END);
  return start < 0 || end < start ? undefined : body.slice(start, end + PROVENANCE_END.length);
};

export type BlockCheck = "match" | "missing" | "edited";

export const checkBlock = (body: string, expected: string): BlockCheck => {
  const found = extractBlock(body);
  if (found === undefined) return "missing";
  return found.replace(/\r\n/g, "\n") === expected ? "match" : "edited";
};
