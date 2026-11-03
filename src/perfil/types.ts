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
  readonly fields?: Readonly<Record<string, DomainProfile>>;
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

const FIELD = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const isDefaultDomain = (name: string): name is Domain => DOMAINS.some((domain) => domain === name);

export const parseField = (raw: string | undefined): string | undefined => {
  const name = raw?.trim().toLowerCase();
  return name === undefined || !FIELD.test(name) || isDefaultDomain(name) ? undefined : name;
};

export const fieldNames = (profile: Profile): readonly string[] => Object.keys(profile.fields ?? {}).sort();

export const areaProfileOf = (profile: Profile, name: string): DomainProfile | undefined =>
  isDefaultDomain(name) ? profile.domains[name] : profile.fields?.[name];

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
