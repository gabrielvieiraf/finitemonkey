import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { type Domain, DOMAINS } from "../perfil/types.js";
import { featureMode } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { type ConceptId, domainOf, parseConcept } from "./concepts.js";
import { readConceptEvents, recordConceptEvents } from "./evidence.js";
import {
  answerKey,
  type BudgetCheck,
  budgetFor,
  EMPTY_STATE,
  type Execution,
  gapOf,
  KEY_RULE,
  present,
  type Probe,
  PROBE_KINDS,
  type ProbeKind,
  type ProbeOption,
  PROBES_FEATURE,
  type ProbeState,
  type ProbeStatus,
  settle,
} from "./probes.js";

export const PROBES_FILE = "probes.json";
const RUN_TIMEOUT_MS = 30_000;
const STATUSES: readonly ProbeStatus[] = ["open", "right", "wrong", "answered", "skipped", "invalid"];

export const probesPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, PROBES_FILE));

const text = (record: JsonObject, key: string): string | undefined =>
  typeof record[key] === "string" ? record[key] : undefined;

const optionOf = (value: unknown): ProbeOption | undefined => {
  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["text"] !== "string") return undefined;
  return { id: value["id"], text: value["text"], ...(typeof value["run"] === "string" ? { run: value["run"] } : {}) };
};

const probeOf = (value: unknown): Probe | undefined => {
  if (!isRecord(value)) return undefined;
  const kind = PROBE_KINDS.find((item) => item === value["kind"]);
  const concept = parseConcept(text(value, "concept"));
  const status = STATUSES.find((item) => item === value["status"]);
  const id = text(value, "id");
  const at = text(value, "at");
  if (kind === undefined || concept === undefined || status === undefined || id === undefined || at === undefined)
    return undefined;
  const optional = (key: string): Readonly<Record<string, string>> => {
    const found = text(value, key);
    return found === undefined ? {} : { [key]: found };
  };
  return {
    id,
    kind,
    concept,
    domain: domainOf(concept),
    question: text(value, "question") ?? "",
    why: text(value, "why") ?? "",
    options: (Array.isArray(value["options"]) ? value["options"] : []).flatMap((item) => {
      const option = optionOf(item);
      return option === undefined ? [] : [option];
    }),
    key: text(value, "key") ?? null,
    status,
    at,
    ...optional("run"),
    ...optional("input"),
    ...optional("session"),
    ...optional("presentedAt"),
    ...optional("answer"),
    ...optional("answeredAt"),
  };
};

const record = (value: unknown): Readonly<Record<string, string>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

const counts = (value: unknown): Readonly<Record<string, number>> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
      )
    : {};

export const readProbeState = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ProbeState => {
  const raw = readJsonFile(runtime, probesPath(paths));
  if (raw === undefined) return EMPTY_STATE;
  return {
    probes: (Array.isArray(raw["probes"]) ? raw["probes"] : []).flatMap((item) => {
      const probe = probeOf(item);
      return probe === undefined ? [] : [probe];
    }),
    skips: counts(raw["skips"]),
    pausedUntil: record(raw["pausedUntil"]),
  };
};

const probeJson = (probe: Probe): JsonObject => ({
  ...probe,
  options: probe.options.map((option) => ({ ...option })),
});

export const writeProbeState = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, state: ProbeState): boolean =>
  writeJsonFile(runtime, probesPath(paths), {
    schema: "finitemonkey/probes@1",
    probes: state.probes.map(probeJson),
    skips: { ...state.skips },
    pausedUntil: { ...state.pausedUntil },
  }).ok;

const execute = (runtime: Runtime, root: AbsolutePath, run: string, input: string | undefined): Execution => {
  const result = runtime.exec({
    command: run,
    args: [],
    cwd: root,
    shell: true,
    timeoutMs: RUN_TIMEOUT_MS,
    env: { CI: "1" },
    unset: ["NODE_TEST_CONTEXT"],
    ...(input === undefined ? {} : { input }),
  });
  return { exitCode: result.timedOut || !result.found ? null : result.exitCode, stdout: result.stdout };
};

export interface ProbeDraft {
  readonly kind: ProbeKind;
  readonly concept: ConceptId;
  readonly question: string;
  readonly why: string;
  readonly options: readonly ProbeOption[];
  readonly run?: string;
  readonly input?: string;
}

export const keyFor = (runtime: Runtime, root: AbsolutePath, draft: ProbeDraft): string | null => {
  const rule = KEY_RULE[draft.kind];
  if (rule === "none") return null;
  if (rule === "observe")
    return draft.run === undefined
      ? null
      : answerKey(draft.kind, draft.options, execute(runtime, root, draft.run, draft.input), new Map());
  const perOption = new Map(
    draft.options.flatMap((option): [string, Execution][] =>
      option.run === undefined ? [] : [[option.id, execute(runtime, root, option.run, draft.input)]],
    ),
  );
  return answerKey(draft.kind, draft.options, undefined, perOption);
};

export const proposeProbe = (runtime: Runtime, paths: FmPaths, draft: ProbeDraft): Probe => {
  const state = readProbeState(runtime, paths);
  const key = keyFor(runtime, paths.root, draft);
  const invalid = key === null && KEY_RULE[draft.kind] !== "none";
  const probe: Probe = {
    id: `P${String(state.probes.length + 1)}`,
    kind: draft.kind,
    concept: draft.concept,
    domain: domainOf(draft.concept),
    question: draft.question,
    why: draft.why,
    options: draft.options,
    key,
    status: invalid ? "invalid" : "open",
    at: runtime.now(),
    ...(draft.run === undefined ? {} : { run: draft.run }),
    ...(draft.input === undefined ? {} : { input: draft.input }),
  };
  writeProbeState(runtime, paths, { ...state, probes: [...state.probes, probe] });
  return probe;
};

export const sustainedDomains = (
  runtime: Pick<Runtime, "readText" | "homeDir">,
  paths: FmPaths,
  state: ProbeState,
  now: number,
): ReadonlySet<Domain> => {
  if (featureMode(runtime, paths, PROBES_FEATURE) !== "active") return new Set();
  const events = readConceptEvents(runtime, paths);
  return new Set(DOMAINS.filter((domain) => gapOf(domain, state, events, now).state === "sustained"));
};

export const nextProbe = (
  runtime: Runtime,
  paths: FmPaths,
  session: string | undefined,
  now: number,
): { readonly probe: Probe | undefined; readonly budget: BudgetCheck | undefined } => {
  const state = readProbeState(runtime, paths);
  const shown = state.probes.find((probe) => probe.status === "open" && probe.presentedAt !== undefined);
  if (shown !== undefined) return { probe: shown, budget: { ok: true } };
  const events = readConceptEvents(runtime, paths);
  const sustained = sustainedDomains(runtime, paths, state, now);
  let refused: BudgetCheck | undefined;
  for (const probe of state.probes.filter((item) => item.status === "open")) {
    const budget = budgetFor(state, probe, session, now, events, sustained);
    if (!budget.ok) {
      refused ??= budget;
      continue;
    }
    writeProbeState(runtime, paths, present(state, probe.id, session, new Date(now).toISOString()));
    return { probe, budget };
  }
  return { probe: undefined, budget: refused };
};

export const answerProbe = (
  runtime: Runtime,
  paths: FmPaths,
  id: string,
  answer: string | undefined,
): Probe | undefined => {
  const state = readProbeState(runtime, paths);
  const next = settle(state, id, answer, runtime.now());
  const probe = next.probes.find((item) => item.id === id);
  if (probe === undefined || next === state) return undefined;
  writeProbeState(runtime, paths, next);
  const executable = probe.kind !== "language" && probe.kind !== "clarify";
  if (executable && (probe.status === "right" || probe.status === "wrong"))
    recordConceptEvents(runtime, paths, [
      {
        concept: probe.concept,
        kind: probe.status === "right" ? "prediction_right" : "prediction_wrong",
        origin: "person",
      },
    ]);
  return probe;
};
