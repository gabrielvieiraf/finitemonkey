import { existsSync } from "node:fs";

import { CONCEPTS } from "../src/conceitos/concepts.js";
import { isRecord, type JsonObject } from "../src/core/parsed.js";
import { levelOf } from "../src/perfil/types.js";
import { type KnowledgeBand, type Level, PERFIL_DOMAINS } from "./bench-family.js";
import { json, lines, records, str, unique, yaml } from "./bench-state.js";

export const INSTRUMENTS_SCHEMA = "finitemonkey/bench-instruments@1";
export const GENERAL = "general";

export interface GroundTruth {
  readonly knowledge: Readonly<Record<string, KnowledgeBand>>;
  readonly fmDomain: string;
  readonly fmConcepts: readonly string[];
}

const EXPECTED_LEVEL: Readonly<Record<KnowledgeBand, Level>> = {
  within: "advanced",
  edge: "intermediate",
  beyond: "beginner",
};

const XRAY_BAND: Readonly<Record<KnowledgeBand, string>> = { within: "within", edge: "edge", beyond: "beyond" };
const JUDGE_BAND: Readonly<Record<KnowledgeBand, string>> = {
  within: "demonstrated",
  edge: "proximal",
  beyond: "beyond",
};
const MOVE_LEVELS: ReadonlySet<string> = new Set(["predicted", "used", "fixed"]);
const PROOF_KINDS: ReadonlySet<string> = new Set(["prediction_right", "own_change", "own_repair", "check_right"]);

const conceptDomain = (concept: string): string =>
  CONCEPTS.find((item) => item.id === concept)?.domain ??
  (concept.includes("/") ? (concept.split("/")[0] ?? GENERAL) : GENERAL);

const truthOf = (truth: GroundTruth, domain: string): KnowledgeBand | undefined => truth.knowledge[domain];

const perfilOf = (dir: string, truth: GroundTruth): JsonObject => {
  const root = yaml(dir, "perfil.yml");
  const domains = isRecord(root?.["domains"]) ? root["domains"] : {};
  const levels: Record<string, string> = {};
  const expected: Record<string, string> = {};
  let matches = 0;
  let judged = 0;
  for (const domain of PERFIL_DOMAINS) {
    const entry = domains[domain];
    const raw = isRecord(entry) ? entry["knowledge"] : undefined;
    const score = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : 50;
    const level = levelOf(Number.isFinite(score) ? score : 50);
    levels[domain] = level;
    const band = truthOf(truth, domain);
    if (band === undefined) continue;
    expected[domain] = EXPECTED_LEVEL[band];
    judged += 1;
    if (EXPECTED_LEVEL[band] === level) matches += 1;
  }
  const taskBand = truthOf(truth, truth.fmDomain);
  const taskLevel = levels[truth.fmDomain];
  return {
    present: root !== undefined,
    quickStart: str(root?.["quick_start"]) ?? "never",
    levels,
    expected,
    matches,
    of: judged,
    taskDomain:
      taskBand === undefined || taskLevel === undefined
        ? "not-a-perfil-domain"
        : taskLevel === EXPECTED_LEVEL[taskBand]
          ? "right"
          : "wrong",
  };
};

const xrayOf = (dir: string, truth: GroundTruth): JsonObject => {
  const xray = json(dir, "xray.json");
  if (xray === undefined) return { present: false, expected: null, observed: [], verdict: "absent" };
  const items = records(xray["items"]);
  const concepts = (item: JsonObject): readonly string[] =>
    records(item["concepts"]).flatMap((entry) => (typeof entry["concept"] === "string" ? [entry["concept"]] : []));
  const touching =
    truth.fmConcepts.length === 0
      ? items
      : items.filter((item) => concepts(item).some((concept) => truth.fmConcepts.includes(concept)));
  const observed = unique(touching.flatMap((item) => (typeof item["band"] === "string" ? [item["band"]] : [])));
  const band = truthOf(truth, truth.fmDomain);
  const expected = band === undefined ? null : XRAY_BAND[band];
  const known = observed.filter((item) => item !== "unknown");
  const verdict =
    touching.length === 0
      ? "absent"
      : known.length === 0
        ? "unknown"
        : expected !== null && known.every((item) => item === expected)
          ? "right"
          : "wrong";
  return { present: true, items: items.length, touching: touching.length, expected, observed, verdict };
};

interface Help {
  readonly domain: string;
  readonly criterion: string;
}

const helpsOf = (dir: string): readonly Help[] => [
  ...lines(dir, "log.jsonl")
    .filter((line) => line["event"] === "horizon.help")
    .map((line) => ({ domain: str(line["domain"]) ?? GENERAL, criterion: str(line["criterion"]) ?? "none" })),
  ...lines(dir, "judge.jsonl")
    .filter((line) => line["type"] === "horizon")
    .map((line) => ({
      domain: (str(line["domain"]) ?? GENERAL).split("/")[0] ?? GENERAL,
      criterion: str(line["criterion"]) ?? "none",
    })),
];

const blindBandOf = (dir: string, truth: GroundTruth): JsonObject => {
  const helps = helpsOf(dir);
  const rows: Record<string, { helps: number; withoutCriterion: number }> = {};
  for (const help of helps) {
    const row = rows[help.domain] ?? { helps: 0, withoutCriterion: 0 };
    rows[help.domain] = {
      helps: row.helps + 1,
      withoutCriterion: row.withoutCriterion + (help.criterion === "none" ? 1 : 0),
    };
  }
  const marked = Object.entries(rows)
    .filter(([, row]) => row.withoutCriterion > 0)
    .map(([domain]) => domain);
  const beyond = marked.filter((domain) => truthOf(truth, domain) === "beyond");
  const falsePositives = marked.filter((domain) => truthOf(truth, domain) === "within");
  const expectMark = truthOf(truth, truth.fmDomain) === "beyond";
  const verdict = expectMark
    ? marked.includes(truth.fmDomain)
      ? "right"
      : beyond.length > 0
        ? "other-domain"
        : marked.includes(GENERAL)
          ? "unattributed"
          : "missed"
    : marked.includes(truth.fmDomain)
      ? "false-positive"
      : "right";
  return {
    rows,
    marked: marked.sort(),
    beyond: beyond.sort(),
    falsePositives: falsePositives.sort(),
    expectMark,
    verdict,
  };
};

interface Fired {
  readonly source: string;
  readonly concept: string;
  readonly domain: string;
}

const firedOf = (dir: string): readonly Fired[] => {
  const predicted = lines(dir, "log.jsonl")
    .filter((line) => line["event"] === "predict.asked")
    .map((line) => str(line["concept"]) ?? "")
    .filter((concept) => concept !== "")
    .map((concept) => ({ source: "predict", concept, domain: conceptDomain(concept) }));
  const cache = json(dir, "cache/predictions.json");
  const asked = isRecord(cache?.["asked"]) ? Object.keys(cache["asked"]) : [];
  const pending = asked
    .filter((concept) => !predicted.some((item) => item.concept === concept))
    .map((concept) => ({ source: "predict", concept, domain: conceptDomain(concept) }));
  const probes = records(json(dir, "probes.json")?.["probes"])
    .filter((probe) => probe["presentedAt"] !== undefined)
    .map((probe) => {
      const concept = str(probe["concept"]) ?? "";
      return { source: "probe", concept, domain: str(probe["domain"]) ?? conceptDomain(concept) };
    });
  const judged = lines(dir, "judge.jsonl")
    .filter((line) => line["type"] === "probe")
    .flatMap((line) => {
      const concepts = Array.isArray(line["concepts"])
        ? line["concepts"].filter((item) => typeof item === "string")
        : [];
      return concepts.map((concept) => ({ source: "judge-probe", concept, domain: conceptDomain(concept) }));
    });
  return [...predicted, ...pending, ...probes, ...judged];
};

const probesOf = (dir: string, truth: GroundTruth): JsonObject => {
  const fired = firedOf(dir);
  const hits = fired.filter((item) => truthOf(truth, item.domain) === "beyond");
  const falsePositives = fired.filter((item) => truthOf(truth, item.domain) === "within");
  const shouldFire = truthOf(truth, truth.fmDomain) === "beyond";
  const verdict =
    falsePositives.length > 0 ? "false-positive" : shouldFire ? (hits.length > 0 ? "right" : "silent") : "right";
  return {
    fired: fired.map((item) => ({ ...item })),
    hits: hits.length,
    falsePositives: falsePositives.map((item) => ({ ...item })),
    shouldFire,
    verdict,
  };
};

const trajectoryOf = (dir: string): JsonObject => {
  const events = lines(dir, "conceitos-events.jsonl");
  const book = yaml(dir, "conceitos.yml");
  const levels = isRecord(book?.["concepts"]) ? book["concepts"] : {};
  const proofs = (concept: string): number =>
    events.filter(
      (event) =>
        event["concept"] === concept &&
        event["origin"] === "person" &&
        PROOF_KINDS.has(str(event["kind"]) ?? "") &&
        (typeof event["weight"] !== "number" || event["weight"] > 0),
    ).length;
  const positive = (concept: string): boolean =>
    events.some((event) => event["concept"] === concept && typeof event["weight"] === "number" && event["weight"] > 0);
  const bookMoved = Object.entries(levels)
    .filter(([, entry]) => isRecord(entry) && MOVE_LEVELS.has(str(entry["level"]) ?? ""))
    .map(([concept]) => concept);
  const evidenceMoved = unique(
    events.flatMap((event) => (typeof event["concept"] === "string" ? [event["concept"]] : [])),
  ).filter(positive);
  const moved = unique([...bookMoved, ...evidenceMoved]);
  const withoutProof = moved.filter((concept) => proofs(concept) === 0);
  const agentCredit = events.filter(
    (event) =>
      event["origin"] === "agent" &&
      PROOF_KINDS.has(str(event["kind"]) ?? "") &&
      typeof event["weight"] === "number" &&
      event["weight"] > 0,
  ).length;
  const domains = unique(moved.map(conceptDomain));
  const verdict =
    withoutProof.length > 0 || agentCredit > 0
      ? "moved-without-proof"
      : moved.length > 0
        ? "moved-with-proof"
        : "still";
  return {
    events: events.length,
    exposures: events.filter((event) => event["kind"] === "exposure").length,
    moved,
    domains,
    withoutProof,
    agentCredit,
    verdict,
  };
};

const judgeOf = (dir: string, truth: GroundTruth): JsonObject => {
  const entries = lines(dir, "judge.jsonl");
  if (entries.length === 0) return { present: false, verdict: "absent" };
  const supports = entries.filter((entry) => entry["type"] === "support");
  const count = (state: string): number => supports.filter((entry) => entry["state"] === state).length;
  const bands = [...supports, ...entries.filter((entry) => entry["type"] === "event")].flatMap((entry) =>
    isRecord(entry["bands"])
      ? Object.entries(entry["bands"]).filter(
          ([domain, band]) =>
            (domain === truth.fmDomain || domain.startsWith(`${truth.fmDomain}/`)) && typeof band === "string",
        )
      : [],
  );
  const fieldBand = str(bands.at(-1)?.[1]) ?? "no record";
  const band = truthOf(truth, truth.fmDomain);
  const expected = band === undefined ? null : JUDGE_BAND[band];
  const outcomes = supports.flatMap((entry) => (typeof entry["outcome"] === "string" ? [entry["outcome"]] : []));
  const items = entries.filter((entry) => entry["type"] === "item");
  return {
    present: true,
    claims: entries.filter((entry) => entry["type"] === "claim").length,
    modelOnly: count("model-only"),
    machineVerified: count("machine-verified"),
    mismatches: outcomes.filter((outcome) => outcome === "mismatch").length,
    unresolved: outcomes.filter((outcome) => outcome === "unresolved").length,
    numberFlags: outcomes.filter((outcome) => ["unit", "magnitude", "unanchored"].includes(outcome)).length,
    quarantined: items.filter((entry) => typeof entry["instructions"] === "number" && entry["instructions"] > 0).length,
    triageFlags: entries.filter((entry) => entry["type"] === "signal" && entry["family"] === "triage-flag").length,
    fieldBand,
    expected,
    verdict: fieldBand === "no record" ? "no-record" : fieldBand === expected ? "right" : "wrong",
  };
};

export const scoreInstruments = (fmDir: string | undefined, truth: GroundTruth): JsonObject => {
  if (fmDir === undefined || !existsSync(fmDir)) return { schema: INSTRUMENTS_SCHEMA, collected: false };
  return {
    schema: INSTRUMENTS_SCHEMA,
    collected: true,
    fmDomain: truth.fmDomain,
    truth: truthOf(truth, truth.fmDomain) ?? null,
    perfil: perfilOf(fmDir, truth),
    xray: xrayOf(fmDir, truth),
    blindBand: blindBandOf(fmDir, truth),
    probes: probesOf(fmDir, truth),
    trajectory: trajectoryOf(fmDir),
    judge: judgeOf(fmDir, truth),
  };
};
