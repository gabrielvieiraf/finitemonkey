import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseJsonObject } from "../src/core/parsed.js";
import { type ArmOverhead, type Evidence, type GuardBudget, parseEvidence } from "./evidence-rates.js";
import type { Lang } from "./footprint-text.js";

export const EVIDENCE_FILE = join("bench", "evidence.json");

interface EvidenceWords {
  readonly intro: (version: string, budget: GuardBudget, synthetic: boolean) => string;
  readonly none: string;
  readonly guardColumns: readonly string[];
  readonly armColumns: readonly string[];
  readonly noRuns: string;
  readonly runsIntro: string;
  readonly reviewIntro: (benchmark: string, commit: string, judge: string) => string;
  readonly reviewColumns: readonly string[];
}

const WORDS: Readonly<Record<Lang, EvidenceWords>> = {
  en: {
    intro: (version, budget, synthetic) =>
      `Error rates of the always-on guards, replayed with \`npm run evidence\` on version ${version} over the labeled corpus in [bench/corpus](bench/corpus). A release fails when a guard's false positive rate goes over ${pct(budget.fprFail)} or its corpus has fewer than ${String(budget.minPositives)} cases that should block or ${String(budget.minNegatives)} that should pass.${synthetic ? " Every case so far is synthetic, written from the guards' own test lists; cases from real sessions will be counted apart." : ""}`,
    none: "No measurement yet.",
    guardColumns: ["Guard", "Should block", "Should allow", "False positives", "False negatives", "p95 (ms)"],
    armColumns: ["Arm", "Runs", "Tokens (median)", "Wall time (median, s)", "False done"],
    noRuns: "Cost against plain Claude Code on the same tasks: not measured yet.",
    runsIntro: "Cost against plain Claude Code on the same tasks:",
    reviewIntro: (benchmark, commit, judge) =>
      `Review against ${benchmark} at \`${commit.slice(0, 12)}\`, judged by ${judge}:`,
    reviewColumns: ["Arm", "PRs", "Precision", "Recall", "F1"],
  },
  "pt-BR": {
    intro: (version, budget, synthetic) =>
      `Taxas de erro dos guards sempre ligados, reproduzidas com \`npm run evidence\` na versão ${version} sobre o corpus rotulado em [bench/corpus](bench/corpus). Uma release falha quando a taxa de falso positivo de um guard passa de ${pct(budget.fprFail)} ou quando o corpus dele tem menos de ${String(budget.minPositives)} casos que devem bloquear ou ${String(budget.minNegatives)} que devem passar.${synthetic ? " Por enquanto todo caso é sintético, escrito a partir das listas de teste dos próprios guards; casos de sessões reais vão ser contados à parte." : ""}`,
    none: "Ainda sem medição.",
    guardColumns: ["Guard", "Deve bloquear", "Deve deixar", "Falsos positivos", "Falsos negativos", "p95 (ms)"],
    armColumns: ["Braço", "Execuções", "Tokens (mediana)", "Tempo (mediana, s)", "Pronto falso"],
    noRuns: "Custo contra o Claude Code puro nas mesmas tarefas: ainda não medido.",
    runsIntro: "Custo contra o Claude Code puro nas mesmas tarefas:",
    reviewIntro: (benchmark, commit, judge) =>
      `Revisão contra ${benchmark} em \`${commit.slice(0, 12)}\`, com ${judge} como juiz:`,
    reviewColumns: ["Braço", "PRs", "Precisão", "Revocação", "F1"],
  },
  es: {
    intro: (version, budget, synthetic) =>
      `Tasas de error de los guards siempre activos, reproducidas con \`npm run evidence\` en la versión ${version} sobre el corpus etiquetado en [bench/corpus](bench/corpus). Una release falla cuando la tasa de falsos positivos de un guard pasa del ${pct(budget.fprFail)} o cuando su corpus tiene menos de ${String(budget.minPositives)} casos que deben bloquear o ${String(budget.minNegatives)} que deben pasar.${synthetic ? " Por ahora todos los casos son sintéticos, escritos a partir de las listas de prueba de los propios guards; los casos de sesiones reales se contarán aparte." : ""}`,
    none: "Todavía sin medición.",
    guardColumns: ["Guard", "Debe bloquear", "Debe dejar", "Falsos positivos", "Falsos negativos", "p95 (ms)"],
    armColumns: ["Brazo", "Ejecuciones", "Tokens (mediana)", "Tiempo (mediana, s)", "Listo falso"],
    noRuns: "Costo frente a Claude Code solo en las mismas tareas: todavía sin medir.",
    runsIntro: "Costo frente a Claude Code solo en las mismas tareas:",
    reviewIntro: (benchmark, commit, judge) =>
      `Revisión contra ${benchmark} en \`${commit.slice(0, 12)}\`, con ${judge} como juez:`,
    reviewColumns: ["Brazo", "PRs", "Precisión", "Exhaustividad", "F1"],
  },
};

const pct = (value: number): string => `${String(Math.round(value * 1000) / 10)}%`;

const rate = (count: number, total: number, value: number): string =>
  `${String(count)}/${String(total)} (${(value * 100).toFixed(1)}%)`;

const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

const divider = (count: number): string => `|${"---|".repeat(count)}`;

const dash = (value: number | null, format: (value: number) => string): string =>
  value === null ? "-" : format(value);

const armRow = (arm: ArmOverhead): string =>
  row([
    `\`${arm.arm}\``,
    String(arm.runs),
    dash(arm.tokensMedian, (value) => String(Math.round(value))),
    dash(arm.wallMsMedian, (value) => (value / 1000).toFixed(1)),
    dash(arm.falseDoneRate, (value) => `${(value * 100).toFixed(1)}%`),
  ]);

export const renderEvidence = (lang: Lang, evidence: Evidence | undefined): string => {
  const words = WORDS[lang];
  if (evidence === undefined || evidence.guards.length === 0) return words.none;
  const guards = [
    row(words.guardColumns),
    divider(words.guardColumns.length),
    ...evidence.guards.map((guard) =>
      row([
        `\`${guard.guard}\``,
        String(guard.positives),
        String(guard.negatives),
        rate(guard.falsePositives, guard.negatives, guard.fpr),
        rate(guard.falseNegatives, guard.positives, guard.fnr),
        guard.p95Ms.toFixed(1),
      ]),
    ),
  ];
  const arms =
    evidence.arms.length === 0
      ? [words.noRuns]
      : [words.runsIntro, "", row(words.armColumns), divider(words.armColumns.length), ...evidence.arms.map(armRow)];
  const synthetic = evidence.guards.every((guard) => guard.byOrigin.session === 0);
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const review =
    evidence.review === null
      ? []
      : [
          "",
          words.reviewIntro(evidence.review.benchmark, evidence.review.commit, evidence.review.judgeModel),
          "",
          row(words.reviewColumns),
          divider(words.reviewColumns.length),
          ...evidence.review.arms.map((arm) =>
            row([`\`${arm.arm}\``, String(arm.reviews), percent(arm.precision), percent(arm.recall), percent(arm.f1)]),
          ),
        ];
  return [words.intro(evidence.version, evidence.budget, synthetic), "", ...guards, "", ...arms, ...review].join("\n");
};

export const readEvidence = (root: string): Evidence | undefined => {
  const file = join(root, EVIDENCE_FILE);
  if (!existsSync(file)) return undefined;
  const raw = parseJsonObject(readFileSync(file, "utf8"));
  if (!raw.ok) return undefined;
  const parsed = parseEvidence(raw.value);
  return parsed.ok ? parsed.value : undefined;
};
