import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { taskRelative } from "../task/load.js";
import { fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";

export const REVIEW_STATE_FILE = ".finitemonkey/review/state.json";
export const FULL_ROUNDS = 3;
export const REVIEW_FILE_MAX_LINES = 200;
export const LEDGER_MAX_LINES = 100;

export interface ReviewState {
  readonly base: string;
  readonly rounds: number;
  readonly lastHead: string;
}

export interface ReviewPacket {
  readonly round: number;
  readonly base: string;
  readonly head: string;
  readonly range: string;
  readonly text: string;
}

const statePath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, REVIEW_STATE_FILE));

export const readReviewState = (runtime: Runtime, root: AbsolutePath): ReviewState | undefined => {
  const raw = runtime.readText(statePath(root));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  if (parsed === undefined || !parsed.ok || !isRecord(parsed.value)) return undefined;
  const { base, rounds, lastHead } = parsed.value;
  return typeof base === "string" && typeof rounds === "number" && typeof lastHead === "string"
    ? { base, rounds, lastHead }
    : undefined;
};

const git = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, root);
  return result.ok ? result.stdout : undefined;
};

const lastLines = (text: string, max: number): string => text.split("\n").slice(-max).join("\n");

const section = (title: string, body: string | undefined, empty: string): string =>
  `## ${title}\n\n${body === undefined || body.trim() === "" ? empty : body.trimEnd()}\n`;

const taskSections = (runtime: Runtime, root: AbsolutePath): readonly string[] => {
  const paths = fmPaths(root);
  const active = readState(runtime, paths).active;
  if (active === undefined)
    return [section("Contract", undefined, "(no active task)"), section("Evidence ledger", undefined, "(none)")];
  const contract = runtime.readText(toAbsolutePath(join(root, taskRelative(active))));
  const ledger = runtime.readText(paths.evidence(active));
  return [
    section("Contract", contract.ok ? contract.value : undefined, "(contract file missing)"),
    section("Evidence ledger", ledger.ok ? lastLines(ledger.value, LEDGER_MAX_LINES) : undefined, "(none)"),
  ];
};

const reviewFile = (runtime: Runtime, root: AbsolutePath, base: string): string | undefined => {
  const text = git(runtime, root, ["show", `${base}:REVIEW.md`]);
  return text === undefined ? undefined : text.split("\n").slice(0, REVIEW_FILE_MAX_LINES).join("\n");
};

const nextState = (previous: ReviewState | undefined, base: string, head: string): ReviewState => {
  if (previous?.base !== base) return { base, rounds: 1, lastHead: head };
  return { base, rounds: previous.rounds + 1, lastHead: head };
};

export const buildPacket = (runtime: Runtime, root: AbsolutePath, base: string, head: string): ReviewPacket => {
  const previous = readReviewState(runtime, root);
  const state = nextState(previous, base, head);
  const from = state.rounds > FULL_ROUNDS && previous !== undefined ? previous.lastHead : base;
  const range = `${from}...${head}`;
  const diff = git(runtime, root, ["diff", "--no-color", "--no-ext-diff", range, "--", ".", ":(exclude).finitemonkey"]);
  const owners = reviewFile(runtime, root, base);
  const text = [
    `# Review packet (round ${String(state.rounds)}, ${range})`,
    "",
    ...(state.rounds > FULL_ROUNDS ? ["Only the diff since the last review round is included.", ""] : []),
    section("Diff", diff, "(empty diff)"),
    ...taskSections(runtime, root),
    ...(owners === undefined ? [] : [section("REVIEW.md (base branch)", owners, "")]),
  ].join("\n");
  runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey", "review")));
  runtime.writeAtomic(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
  return { round: state.rounds, base, head, range, text };
};
