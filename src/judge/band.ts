import {
  type Band,
  type ContestEntry,
  DEMONSTRATED_AFTER,
  type EvidenceEntry,
  type JudgeEntry,
  type ProofKind,
} from "./types.js";

const PERSON_ONLY: ReadonlySet<ProofKind> = new Set(["prediction", "probe", "person-repair", "source-check"]);

export interface BandStep {
  readonly band: Band;
  readonly evidence: string;
  readonly proof: ProofKind;
  readonly at: string;
}

export interface ConceptBand {
  readonly concept: string;
  readonly band: Band;
  readonly because?: BandStep;
  readonly history: readonly BandStep[];
  readonly positive: number;
  readonly negative: number;
  readonly exposures: number;
  readonly contested: readonly string[];
}

export const weightOf = (entry: EvidenceEntry): number => {
  if (entry.proof === "exposure") return 0;
  if (entry.proof === "failure-after-acceptance") return -1;
  if (entry.origin === "agent") return 0;
  if (PERSON_ONLY.has(entry.proof) && entry.origin !== "person") return 0;
  return entry.result === "pass" ? 1 : -1;
};

export const evidenceOf = (entries: readonly JudgeEntry[]): readonly EvidenceEntry[] =>
  entries.filter((entry): entry is EvidenceEntry => entry.type === "evidence");

const contestsOf = (entries: readonly JudgeEntry[]): readonly ContestEntry[] =>
  entries.filter((entry): entry is ContestEntry => entry.type === "contest");

const newerOn = (evidence: readonly EvidenceEntry[], concepts: readonly string[], at: string): boolean =>
  evidence.some((item) => item.at > at && item.concepts.some((concept) => concepts.includes(concept)));

export const isContested = (
  entry: EvidenceEntry,
  contests: readonly ContestEntry[],
  evidence: readonly EvidenceEntry[],
): boolean =>
  contests.some(
    (contest) =>
      (contest.target === entry.id || (entry.concepts.includes(contest.target) && entry.at <= contest.at)) &&
      !newerOn(evidence, entry.concepts, contest.at),
  );

export const countRule = (weights: readonly number[]): Band => {
  if (weights.length === 0) return "no record";
  const lastNegative = weights.findLastIndex((weight) => weight < 0);
  const fresh = weights.slice(lastNegative + 1).filter((weight) => weight > 0).length;
  if (fresh >= DEMONSTRATED_AFTER) return "demonstrated";
  if (lastNegative < 0) return "proximal";
  const before = weights.slice(0, lastNegative).filter((weight) => weight > 0).length;
  if (fresh > 0) return "proximal";
  return before >= DEMONSTRATED_AFTER ? "proximal" : "beyond";
};

export const effective = (weighted: readonly EvidenceEntry[]): readonly EvidenceEntry[] => {
  const positives = weighted.filter((entry) => weightOf(entry) > 0);
  const [only] = positives;
  return positives.length === 1 && only?.proof === "probe" ? weighted.filter((entry) => entry !== only) : weighted;
};

const historyOf = (weighted: readonly EvidenceEntry[]): readonly BandStep[] => {
  const steps: BandStep[] = [];
  let current: Band = "no record";
  weighted.forEach((entry, index) => {
    const band = countRule(effective(weighted.slice(0, index + 1)).map(weightOf));
    if (band !== current) steps.push({ band, evidence: entry.id, proof: entry.proof, at: entry.at });
    current = band;
  });
  return steps;
};

export const conceptBand = (concept: string, entries: readonly JudgeEntry[]): ConceptBand => {
  const evidence = evidenceOf(entries);
  const contests = contestsOf(entries);
  const mine = evidence.filter((entry) => entry.concepts.includes(concept));
  const contested = mine.filter((entry) => isContested(entry, contests, evidence));
  const counted = mine.filter((entry) => !contested.includes(entry));
  const weighted = counted.filter((entry) => weightOf(entry) !== 0);
  const history = historyOf(weighted);
  const because = history.at(-1);
  return {
    concept,
    band: countRule(effective(weighted).map(weightOf)),
    ...(because === undefined ? {} : { because }),
    history,
    positive: weighted.filter((entry) => weightOf(entry) > 0).length,
    negative: weighted.filter((entry) => weightOf(entry) < 0).length,
    exposures: mine.filter((entry) => entry.proof === "exposure").length,
    contested: contested.map((entry) => entry.id),
  };
};

const RANK: Readonly<Record<Band, number>> = { beyond: 0, "no record": 1, proximal: 2, demonstrated: 3 };

export const worstBand = (bands: readonly Band[]): Band =>
  bands.reduce<Band | undefined>(
    (worst, band) => (worst === undefined || RANK[band] < RANK[worst] ? band : worst),
    undefined,
  ) ?? "no record";
