import { DOMAINS } from "../perfil/types.js";
import { type BandDomain, type Criterion, GENERAL } from "../signals/blind-band.js";
import { urlOf } from "./fetch.js";
import type { CriterionKind, HorizonEntry, HorizonKind, JudgeEntry } from "./types.js";

export const HORIZON_FEATURE = "horizon-criterion";

export interface ProposedHelp {
  readonly kind: HorizonKind;
  readonly text: string;
  readonly criterion?: CriterionKind;
  readonly answer?: string;
}

export type HorizonProposer = (subject: string) => readonly ProposedHelp[] | undefined;

export interface HorizonView {
  readonly help: string;
  readonly kind: HorizonKind;
  readonly text: string;
  readonly criterion: CriterionKind;
  readonly answer?: string;
  readonly domain: string;
  readonly state: HorizonEntry["state"];
}

export interface HorizonDomain {
  readonly domain: string;
  readonly shown: number;
  readonly accepted: number;
  readonly dismissed: number;
  readonly acceptedWithoutCriterion: number;
  readonly index: number;
}

const SOURCE_REF = /^(?:10\.\d{4,9}\/\S+|https?:\/\/\S+|[\w./-]+\.\w+)$/;

export const sourceRef = (answer: string): boolean => urlOf(answer) !== undefined || SOURCE_REF.test(answer);

export const criterionOf = (wanted: CriterionKind | undefined, answer: string | undefined): CriterionKind => {
  const given = answer?.trim() ?? "";
  if (given === "" || wanted === undefined || wanted === "none") return "none";
  if (wanted === "source-span") return sourceRef(given.split(/\s+/)[0] ?? "") ? "source-span" : "none";
  return wanted;
};

export const latestHelps = (entries: readonly JudgeEntry[]): readonly HorizonEntry[] => {
  const latest = new Map<string, HorizonEntry>();
  for (const entry of entries) if (entry.type === "horizon") latest.set(entry.id, entry);
  return [...latest.values()];
};

export const helpView = (entry: HorizonEntry): HorizonView => ({
  help: entry.id,
  kind: entry.kind,
  text: entry.text,
  criterion: entry.criterion,
  ...(entry.answer === undefined ? {} : { answer: entry.answer }),
  domain: entry.domain,
  state: entry.state,
});

const share = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 1000);

export const horizonDomains = (entries: readonly JudgeEntry[]): readonly HorizonDomain[] => {
  const helps = latestHelps(entries);
  return [...new Set(helps.map((help) => help.domain))].sort().map((domain) => {
    const mine = helps.filter((help) => help.domain === domain);
    const accepted = mine.filter((help) => help.state === "accepted");
    const without = accepted.filter((help) => help.criterion === "none").length;
    return {
      domain,
      shown: mine.length,
      accepted: accepted.length,
      dismissed: mine.filter((help) => help.state === "dismissed").length,
      acceptedWithoutCriterion: without,
      index: share(without, accepted.length),
    };
  });
};

export const bandCriterion = (criterion: CriterionKind): Criterion =>
  criterion === "source-span" ? "check" : criterion;

export const bandDomain = (domain: string): BandDomain => DOMAINS.find((item) => item === domain) ?? GENERAL;
