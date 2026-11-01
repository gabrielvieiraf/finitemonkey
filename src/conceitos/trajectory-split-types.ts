export const MIN_EVIDENCE = 6;

export const SPLIT_GROUPS = ["alone", "proximal", "horizon"] as const;
export type SplitGroup = (typeof SPLIT_GROUPS)[number];

export const SPLIT_SIDES = {
  alone: ["known", "transfer"],
  proximal: ["explains", "detects"],
  horizon: ["recognizable", "outOfReach"],
} as const satisfies Readonly<Record<SplitGroup, readonly [string, string]>>;

export type AloneSide = (typeof SPLIT_SIDES.alone)[number];

export interface Split {
  readonly lower: number;
  readonly upper: number;
  readonly evidence: number;
}

export type WeekSplits = Readonly<Record<SplitGroup, Split>>;

export interface OutcomeMark {
  readonly at: string;
  readonly domain: string;
  readonly outcome: "recognizable" | "out_of_reach";
}
