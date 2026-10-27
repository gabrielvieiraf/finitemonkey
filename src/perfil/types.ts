export const DOMAINS = ["product", "interface", "backend", "infrastructure", "security"] as const;
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const MEASURES = ["tool", "knowledge"] as const;

export type Domain = (typeof DOMAINS)[number];
export type Level = (typeof LEVELS)[number];
export type Measure = (typeof MEASURES)[number];

export interface DomainProfile {
  readonly tool: number;
  readonly knowledge: number;
  readonly claimed?: Level;
}

export interface Profile {
  readonly domains: Readonly<Record<Domain, DomainProfile>>;
  readonly quickStart: "done" | "skipped" | "never";
  readonly updatedAt: string;
}

export const START_SCORE = 50;
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

export const levelOf = (score: number): Level => {
  if (score < 35) return "beginner";
  if (score < 70) return "intermediate";
  return "advanced";
};

export const scoreOf = (level: Level): number => {
  if (level === "beginner") return 25;
  if (level === "intermediate") return START_SCORE;
  return 80;
};

export const clampScore = (score: number): number => Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(score)));

export const parseDomain = (raw: string | undefined): Domain | undefined =>
  DOMAINS.find((domain) => domain === raw?.toLowerCase());

export const parseLevel = (raw: string | undefined): Level | undefined =>
  LEVELS.find((level) => level === raw?.toLowerCase());

export const startingProfile = (at: string): Profile => ({
  domains: {
    product: { tool: START_SCORE, knowledge: START_SCORE },
    interface: { tool: START_SCORE, knowledge: START_SCORE },
    backend: { tool: START_SCORE, knowledge: START_SCORE },
    infrastructure: { tool: START_SCORE, knowledge: START_SCORE },
    security: { tool: START_SCORE, knowledge: START_SCORE },
  },
  quickStart: "never",
  updatedAt: at,
});
