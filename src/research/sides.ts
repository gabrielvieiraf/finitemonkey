import type { ResearchLog, ResearchSource, Stance } from "./log.js";

export const RESEARCH_SIDES_FEATURE = "research-sides";

export type StanceProposer = (source: string, unknown: string) => Stance | undefined;

export interface UnknownSides {
  readonly unknown: string;
  readonly favors: readonly string[];
  readonly contests: readonly string[];
  readonly suggested: readonly string[];
  readonly emptySearch: boolean;
  readonly open: boolean;
}

const confirmedOn = (sources: readonly ResearchSource[], unknown: string, stance: Stance): readonly string[] =>
  sources
    .filter((source) => source.resolves === unknown && source.stance === stance && source.stanceBy === "person")
    .map((source) => source.url);

export const sidesOf = (log: ResearchLog): readonly UnknownSides[] =>
  log.question.unknowns.map((unknown) => {
    const favors = confirmedOn(log.sources, unknown, "favors");
    const contests = confirmedOn(log.sources, unknown, "contests");
    const emptySearch = log.emptySearches.some((search) => search.unknown === unknown && search.queries.length > 0);
    const suggested = log.sources
      .filter((source) => source.resolves === unknown && source.stanceBy === "model")
      .map((source) => source.url);
    return {
      unknown,
      favors,
      contests,
      suggested,
      emptySearch,
      open: favors.length === 0 || (contests.length === 0 && !emptySearch),
    };
  });

export const openSides = (log: ResearchLog): readonly string[] =>
  sidesOf(log)
    .filter((sides) => sides.open)
    .map((sides) => sides.unknown);

export const suggestStance = (
  proposer: StanceProposer | undefined,
  source: string,
  unknown: string,
): Stance | undefined => (proposer === undefined || unknown === "" ? undefined : proposer(source, unknown));
