import { accept, isRecord, type JsonObject, type Parsed, reject } from "../src/core/parsed.js";

export const GUARDIAN_RESULTS = "bench/guardian/results.json";
export const GUARDIAN_BENCH_SCHEMA = "finitemonkey/guardian-bench@1";
export const GUARDIAN = "guardian";

export interface GuardianPersona {
  readonly persona: string;
  readonly alertPrecision: number | null;
  readonly unnecessaryAlerts: number;
  readonly missed: number;
  readonly harmfulRedirects: number;
  readonly acceptanceRate: number | null;
}

export interface GuardianEvidence {
  readonly guard: typeof GUARDIAN;
  readonly source: string;
  readonly scenarios: number;
  readonly positives: number;
  readonly negatives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly levelMatches: number;
  readonly fpr: number;
  readonly fnr: number;
  readonly personas: readonly GuardianPersona[];
}

interface Scenario {
  readonly id: string;
  readonly expected: number;
  readonly observed: number;
}

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : Number((part / whole).toFixed(4)));

const scenarioOf = (raw: unknown): Scenario | undefined => {
  if (!isRecord(raw)) return undefined;
  const { id, expected, observed } = raw;
  return typeof id === "string" && typeof expected === "number" && typeof observed === "number"
    ? { id, expected, observed }
    : undefined;
};

const numberOrNull = (value: unknown): number | null | undefined =>
  value === null ? null : typeof value === "number" ? value : undefined;

const personaOf = (persona: string, raw: unknown): GuardianPersona | undefined => {
  if (!isRecord(raw)) return undefined;
  const alertPrecision = numberOrNull(raw["alertPrecision"]);
  const acceptanceRate = numberOrNull(raw["acceptanceRate"]);
  const { unnecessaryAlerts, missed, harmfulRedirects } = raw;
  if (alertPrecision === undefined || acceptanceRate === undefined) return undefined;
  if (typeof unnecessaryAlerts !== "number" || typeof missed !== "number" || typeof harmfulRedirects !== "number") {
    return undefined;
  }
  return { persona, alertPrecision, unnecessaryAlerts, missed, harmfulRedirects, acceptanceRate };
};

const personasOf = (raw: unknown): readonly (GuardianPersona | undefined)[] =>
  isRecord(raw) ? Object.entries(raw).map(([persona, value]) => personaOf(persona, value)) : [];

export const guardianEvidence = (raw: JsonObject, source: string): Parsed<GuardianEvidence> => {
  if (raw["schema"] !== GUARDIAN_BENCH_SCHEMA) return reject(`${source}: schema must be ${GUARDIAN_BENCH_SCHEMA}`);
  const scenarios = Array.isArray(raw["scenarios"]) ? raw["scenarios"].map(scenarioOf) : [];
  const personas = personasOf(raw["personas"]);
  if (scenarios.length === 0 || scenarios.some((item) => item === undefined)) {
    return reject(`${source}: scenarios must list id, expected and observed`);
  }
  if (personas.some((item) => item === undefined)) return reject(`${source}: a persona's metrics are malformed`);
  const all = scenarios.flatMap((item) => (item === undefined ? [] : [item]));
  const positives = all.filter((item) => item.expected > 0);
  const negatives = all.filter((item) => item.expected === 0);
  const falsePositives = negatives.filter((item) => item.observed > 0).length;
  const falseNegatives = positives.filter((item) => item.observed === 0).length;
  return accept({
    guard: GUARDIAN,
    source,
    scenarios: all.length,
    positives: positives.length,
    negatives: negatives.length,
    falsePositives,
    falseNegatives,
    levelMatches: all.filter((item) => item.observed === item.expected).length,
    fpr: ratio(falsePositives, negatives.length),
    fnr: ratio(falseNegatives, positives.length),
    personas: personas.flatMap((item) => (item === undefined ? [] : [item])),
  });
};

const COUNTS = ["scenarios", "positives", "negatives", "falsePositives", "falseNegatives", "levelMatches"] as const;

export const parseGuardianEvidence = (raw: unknown): GuardianEvidence | null => {
  if (!isRecord(raw) || raw["guard"] !== GUARDIAN || typeof raw["source"] !== "string") return null;
  if (!COUNTS.every((key) => typeof raw[key] === "number")) return null;
  if (typeof raw["fpr"] !== "number" || typeof raw["fnr"] !== "number" || !Array.isArray(raw["personas"])) return null;
  const personas = raw["personas"].map((item) =>
    isRecord(item) && typeof item["persona"] === "string" ? personaOf(item["persona"], item) : undefined,
  );
  if (personas.some((item) => item === undefined)) return null;
  const count = (key: (typeof COUNTS)[number]): number => {
    const value = raw[key];
    return typeof value === "number" ? value : 0;
  };
  return {
    guard: GUARDIAN,
    source: raw["source"],
    scenarios: count("scenarios"),
    positives: count("positives"),
    negatives: count("negatives"),
    falsePositives: count("falsePositives"),
    falseNegatives: count("falseNegatives"),
    levelMatches: count("levelMatches"),
    fpr: raw["fpr"],
    fnr: raw["fnr"],
    personas: personas.flatMap((item) => (item === undefined ? [] : [item])),
  };
};

export const harmfulRedirectReasons = (evidence: GuardianEvidence): readonly string[] =>
  evidence.personas
    .filter((persona) => persona.harmfulRedirects > 0)
    .map((persona) => `${String(persona.harmfulRedirects)} harmful redirects for the ${persona.persona} persona`);
