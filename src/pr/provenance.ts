import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import { type Evidence, GATE_CHECK } from "../evidence/types.js";
import { type AddedLine, type Git, gitAt, parseAddedLines, treeHash } from "../gate/git.js";
import { readDecisions } from "../guardian/decisions.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { agentWrites } from "../signals/agent-writes.js";
import { readEntries, signalFiles } from "../signals/store.js";
import { fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { attributeFile, type FileAttribution, hunksText } from "./hunks.js";

export const PROVENANCE_START = "<!-- finitemonkey:provenance";
export const PROVENANCE_END = "<!-- finitemonkey:provenance:end -->";
export const MAX_BLOCK_LINES = 60;

export interface GeneratedFile extends FileAttribution {
  readonly path: string;
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

const addedSince = (git: Git, base: string | undefined, files: readonly string[]): readonly AddedLine[] =>
  base === undefined || files.length === 0
    ? []
    : parseAddedLines(git.out(["diff", "-U0", "--no-color", "--no-ext-diff", `${base}..HEAD`, "--", ...files]) ?? "");

export const provenanceSources = (
  runtime: SourceRuntime,
  root: AbsolutePath,
  files: readonly string[],
  base?: string,
): ProvenanceSources => {
  const paths = fmPaths(root);
  const git = gitAt(runtime, root);
  const task = readState(runtime, paths).active ?? null;
  const tree = treeHash(git) ?? null;
  const writes = agentWrites(readEntries(runtime, signalFiles(paths)));
  const added = addedSince(git, base, files);
  const latest = task === null ? [] : latestPerCheck(readLedger(runtime, paths.evidence(task)));
  const current = (entry: Evidence): boolean => entry.status === "passed" && entry.treeHash === tree;
  return {
    task,
    tree,
    generated: [...files].sort().map((path) => ({
      path,
      ...attributeFile(
        writes.filter((write) => write.file === path),
        added.filter((line) => line.path === path),
      ),
    })),
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

const generatedLine = (file: GeneratedFile): string => {
  if (file.origin === "unknown") return `- ${file.path}: unknown`;
  const hunks = file.hunks === undefined ? "" : `, ${hunksText(file.hunks)}`;
  return `- ${file.path}: agent edits (${String(file.edits)})${hunks}`;
};

export const textHash = (lines: readonly string[]): string => sha256Hex(lines.join("\n")).slice(0, 32);

export const sourcesHash = (sources: ProvenanceSources): string => sha256Hex(JSON.stringify(sources)).slice(0, 32);

export const renderBlock = (sources: ProvenanceSources): string => {
  const body = [
    "## Provenance",
    "",
    `Task: ${sources.task ?? "none"} · tree \`${sources.tree ?? "unknown"}\``,
    "",
    "### Generated",
    ...sources.generated.map(generatedLine),
    "",
    "### Verified",
    ...(sources.verified.length === 0 ? ["- none"] : sources.verified.map(checkLine)),
    "",
    "### Not verified",
    ...(sources.notVerified.length === 0 ? ["- none"] : sources.notVerified.map(checkLine)),
    ...(sources.decisions.length === 0 ? [] : ["", "### Decisions", ...sources.decisions.map((text) => `- ${text}`)]),
  ];
  const lines = capped(body);
  const header = `${PROVENANCE_START} sha256=${sourcesHash(sources)} tree=${sources.tree ?? "unknown"} text=${textHash(lines)} -->`;
  return [header, ...lines, PROVENANCE_END].join("\n");
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
