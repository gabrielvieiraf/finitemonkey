import type { AcceptanceCheck } from "../task/types.js";

export const PERTURBATIONS = ["requirement", "invalid", "empty", "twice", "outside"] as const;

export type Perturbation = (typeof PERTURBATIONS)[number];

const COVERS: Readonly<Record<Perturbation, RegExp | undefined>> = {
  requirement: undefined,
  invalid: /invalid|inv[aá]lid|validat|valida|malformed|reject|recus/i,
  empty: /empty|vazi|vac[ií]|missing|null|blank|zero/i,
  twice: /twice|duplicate|duplicad|idempot|concurr|again|repeat|repet/i,
  outside: /timeout|retry|offline|unavailable|down|fail|falha|fall[oa]|outage|network|rede|red/i,
};

const textOf = (check: AcceptanceCheck): string => [check.id, check.description ?? "", check.run ?? ""].join(" ");

export interface Coverage {
  readonly question: Perturbation;
  readonly checks: readonly string[];
}

export const coverage = (checks: readonly AcceptanceCheck[]): readonly Coverage[] =>
  PERTURBATIONS.map((question) => {
    const pattern = COVERS[question];
    return {
      question,
      checks:
        pattern === undefined ? [] : checks.filter((check) => pattern.test(textOf(check))).map((check) => check.id),
    };
  });
