import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Note } from "../evidence/types.js";
import type { GateContext } from "../gate/types.js";
import { recordPath } from "../knowledge/decision-record.js";
import { readOwnership } from "../ownership/file.js";
import { featureMode } from "../policy/feature.js";
import type { GuardMode } from "../policy/policy.js";
import { baseText, readWorking } from "../quality/gate-sources.js";
import {
  API_BREAKING_FEATURE,
  type BreakingChange,
  breakingChanges,
  type ContractSide,
  versionBumped,
} from "./breaking.js";
import { API_CONSISTENCY_FEATURE, consistencyProblems } from "./consistency.js";
import { type ApiRegistry, CONTRACT_FILE, parseRegistry } from "./registry.js";
import { parseShape } from "./shape.js";

const MAX_LISTED = 10;
const DECISION_DOC = /^docs\/plan\/\d{2,}-decision-[^/]+\.md$/;

export interface ApiOutcome {
  readonly notes: readonly Note[];
  readonly blocking: boolean;
}

const NONE: ApiOutcome = { notes: [], blocking: false };

const note = (key: string, params: Note["params"] = {}): Note => ({ key, params });

const sideOf = (source: string): ContractSide | undefined => {
  const registry = parseRegistry(source);
  return registry.ok ? { registry: registry.value, shape: parseShape(source) } : undefined;
};

const modeOf = (ctx: GateContext, id: string): GuardMode => featureMode(ctx.runtime, ctx.paths, id);

const consistency = (ctx: GateContext, side: ContractSide): ApiOutcome => {
  const mode = modeOf(ctx, API_CONSISTENCY_FEATURE);
  if (mode === "off") return NONE;
  const problems = consistencyProblems(side.registry, side.shape);
  if (problems.length === 0) return NONE;
  const notes = problems
    .slice(0, MAX_LISTED)
    .map((problem) => note(`gate.contract.api.${problem.kind}`, { ...problem }));
  return mode === "active"
    ? { notes, blocking: true }
    : { notes: [note("gate.contract.api_shadow", { count: problems.length }), ...notes], blocking: false };
};

const consumersOf = (ctx: GateContext, registry: ApiRegistry, id: string): readonly string[] => {
  const endpoint = registry.endpoints.find((item) => item.id === id);
  if (endpoint === undefined) return [];
  const ownership = readOwnership(ctx.runtime, ctx.paths.root);
  const components = ownership?.ok === true ? ownership.value.components : [];
  const listed = components
    .filter((component) => component.name === endpoint.domain || component.name === endpoint.id)
    .flatMap((component) => component.consumers);
  return [...new Set([...listed, ...endpoint.screens])];
};

const recordCoversContract = (ctx: GateContext): boolean => {
  const raw = ctx.runtime.readText(recordPath(ctx.paths, ctx.contract.id));
  const record = raw.ok ? parseJsonObject(raw.value) : undefined;
  const paths = record?.ok === true && isRecord(record.value) ? record.value["paths"] : undefined;
  return Array.isArray(paths) && paths.includes(CONTRACT_FILE);
};

const decidedBy = (ctx: GateContext): ((id: string) => boolean) => {
  if (recordCoversContract(ctx)) return () => true;
  const docs = ctx.changes
    .filter((change) => change.status !== "D" && DECISION_DOC.test(change.path))
    .flatMap((change) => readWorking(ctx, change.path) ?? []);
  if (docs.some((text) => text.includes(CONTRACT_FILE))) return () => true;
  return (id) => docs.some((text) => new RegExp(`\\b${id}\\b`).test(text));
};

const breaking = (ctx: GateContext, head: ContractSide): ApiOutcome => {
  const mode = modeOf(ctx, API_BREAKING_FEATURE);
  if (mode === "off") return NONE;
  const source = baseText(ctx, CONTRACT_FILE);
  const base = source === undefined ? undefined : sideOf(source);
  if (base === undefined) return NONE;
  const changes = breakingChanges(base, head);
  if (changes.length === 0) return NONE;
  const decided = decidedBy(ctx);
  const bumped = versionBumped(base, head);
  const open = bumped ? [] : changes.filter((change) => !decided(change.id));
  const accepted = changes.length - open.length;
  const describe = (change: BreakingChange): readonly Note[] => {
    const consumers = consumersOf(ctx, base.registry, change.id);
    return [
      note(`gate.contract.break.${change.kind}`, { ...change }),
      ...(consumers.length === 0 ? [] : [note("gate.contract.break.consumers", { consumers: consumers.join(", ") })]),
    ];
  };
  const acceptedNotes =
    accepted === 0
      ? []
      : [note(bumped ? "gate.contract.break.versioned" : "gate.contract.break.decided", { count: accepted })];
  if (open.length === 0) return { notes: acceptedNotes, blocking: false };
  const listed = open.slice(0, MAX_LISTED).flatMap(describe);
  return mode === "active"
    ? { notes: [...acceptedNotes, ...listed], blocking: true }
    : {
        notes: [note("gate.contract.break_shadow", { count: open.length }), ...acceptedNotes, ...listed],
        blocking: false,
      };
};

export const apiOutcome = (ctx: GateContext): ApiOutcome => {
  const source = readWorking(ctx, CONTRACT_FILE);
  const head = source === undefined ? undefined : sideOf(source);
  if (head === undefined) return NONE;
  const parts = [consistency(ctx, head), breaking(ctx, head)];
  return { notes: parts.flatMap((part) => part.notes), blocking: parts.some((part) => part.blocking) };
};
