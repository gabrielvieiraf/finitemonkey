import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import type { Premise } from "./detect.js";

export const PREMISE_CHECKS_FILE = "premise-checks.json";
export const PROPOSAL_STATES = ["proposed", "approved", "rejected"] as const;
const MAX_PROPOSALS = 100;

export type ProposalState = (typeof PROPOSAL_STATES)[number];

export interface CheckDraft {
  readonly run: string;
  readonly symbols: readonly string[];
  readonly files: readonly string[];
}

export interface PremiseProposal extends CheckDraft {
  readonly id: string;
  readonly text: string;
  readonly at: string;
  readonly state: ProposalState;
  readonly claim?: string;
}

export type PremiseCheckProvider = (premise: Premise) => CheckDraft | undefined;

const SAFE = /^[\w$.-]+$/;
const SAFE_PATH = /^[\w$./-]+$/;
const IDENT = /\b[A-Za-z_$][\w$]*(?:[a-z][A-Z]|_)[\w$]*\b/g;

const ABSENT =
  /\b(?:unused|not used|never (?:called|used)|dead code|(?:doesn't|does not|don't|do not) exist|we (?:don't|do not|never) use)\b|(?<![\p{L}])(?:n[ãa]o (?:usamos|existe|[ée] usad[oa])|nunca [ée] chamad[oa]|no (?:usamos|existe|se usa)|nunca se llama)(?![\p{L}])/iu;
const PRESENT =
  /\b(?:already (?:handles?|does|checks?|exists?|returns?|covers?|validates?)|always returns?)\b|(?<![\p{L}])(?:j[áa] (?:trata|faz|verifica|existe|retorna|cobre|valida)|sempre retorna|ya (?:maneja|hace|verifica|existe|devuelve|cubre|valida)|siempre devuelve)(?![\p{L}])/iu;

const isFile = (ref: string): boolean => ref.includes("/") || /\.[a-z]{1,5}$/i.test(ref);

const quoted = (value: string): string => `'${value}'`;

export const subjectOf = (premise: Premise): Pick<CheckDraft, "symbols" | "files"> => {
  const files = premise.refs.filter((ref) => isFile(ref) && SAFE_PATH.test(ref));
  const named = premise.refs.filter((ref) => !isFile(ref) && SAFE.test(ref));
  const words = [...premise.text.matchAll(IDENT)].map((match) => match[0]);
  const symbols = [...new Set([...named, ...words])].filter((word) => SAFE.test(word)).slice(0, 3);
  return { symbols, files: files.slice(0, 3) };
};

export const templateCheck: PremiseCheckProvider = (premise) => {
  const { symbols, files } = subjectOf(premise);
  const symbol = symbols[0];
  if (symbol === undefined) return undefined;
  const scope = files.length === 0 ? "" : ` -- ${files.map(quoted).join(" ")}`;
  if (ABSENT.test(premise.text))
    return { run: `test "$(git grep -o -w -F -e ${quoted(symbol)} | wc -l)" -le 1`, symbols, files };
  if (PRESENT.test(premise.text)) return { run: `git grep -q -w -F -e ${quoted(symbol)}${scope}`, symbols, files };
  return undefined;
};

export const proposalsPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, PREMISE_CHECKS_FILE));

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const proposalOf = (item: unknown): PremiseProposal | undefined => {
  if (!isRecord(item)) return undefined;
  const { id, text, at, run, state, claim } = item;
  const known = PROPOSAL_STATES.find((value) => value === state);
  if (typeof id !== "string" || typeof text !== "string" || typeof at !== "string" || typeof run !== "string")
    return undefined;
  if (known === undefined) return undefined;
  return {
    id,
    text,
    at,
    run,
    state: known,
    symbols: strings(item["symbols"]),
    files: strings(item["files"]),
    ...(typeof claim === "string" ? { claim } : {}),
  };
};

export const readProposals = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly PremiseProposal[] => {
  const raw = runtime.readText(proposalsPath(paths));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  const list = parsed?.ok === true ? parsed.value["proposals"] : undefined;
  return Array.isArray(list) ? list.flatMap((item) => proposalOf(item) ?? []) : [];
};

export const writeProposals = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  paths: FmPaths,
  proposals: readonly PremiseProposal[],
): boolean => {
  runtime.mkdir(paths.dir);
  return runtime.writeText(
    proposalsPath(paths),
    `${JSON.stringify({ schemaVersion: 1, proposals: proposals.slice(-MAX_PROPOSALS) }, null, 2)}\n`,
  ).ok;
};

export const proposeCheck = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "now">,
  paths: FmPaths,
  premise: Premise,
  provider: PremiseCheckProvider = templateCheck,
): PremiseProposal | undefined => {
  const draft = provider(premise);
  if (draft === undefined || draft.run.trim() === "") return undefined;
  const list = readProposals(runtime, paths);
  const id = `p-${sha256Hex(`${premise.text}\u0000${draft.run}`).slice(0, 8)}`;
  if (list.some((item) => item.id === id)) return undefined;
  const proposal: PremiseProposal = {
    id,
    text: premise.text,
    at: runtime.now(),
    run: draft.run,
    symbols: draft.symbols,
    files: draft.files,
    state: "proposed",
  };
  writeProposals(runtime, paths, [...list, proposal]);
  return proposal;
};

export const settleProposal = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  paths: FmPaths,
  id: string,
  state: Exclude<ProposalState, "proposed">,
  claim?: string,
): void => {
  writeProposals(
    runtime,
    paths,
    readProposals(runtime, paths).map((item) =>
      item.id === id ? { ...item, state, ...(claim === undefined ? {} : { claim }) } : item,
    ),
  );
};
