import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";
import { parseCsv } from "./csv.js";

export const MONTHLY_SUFFIX = "-cost-monthly.csv";

export interface FactMonthly {
  readonly fact: string;
  readonly base: number;
  readonly conservative: number;
}

export interface MonthlyCost {
  readonly file: string;
  readonly facts: readonly FactMonthly[];
}

const amount = (raw: string | undefined): number | undefined => {
  const value = Number((raw ?? "").trim());
  return (raw ?? "").trim() !== "" && Number.isFinite(value) ? value : undefined;
};

const factsIn = (text: string): readonly FactMonthly[] => {
  const [header = [], ...body] = parseCsv(text);
  const at = (name: string): number => header.indexOf(name);
  if (at("fact") === -1 || at("base") === -1 || at("conservative") === -1) return [];
  return body.flatMap((row) => {
    const fact = (row[at("fact")] ?? "").trim();
    const base = amount(row[at("base")]);
    const conservative = amount(row[at("conservative")]) ?? base;
    return fact === "" || base === undefined || conservative === undefined ? [] : [{ fact, base, conservative }];
  });
};

export const readMonthlyCost = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  root: AbsolutePath,
): MonthlyCost | undefined => {
  const name = planFiles(runtime, root)
    .filter((item) => item.endsWith(MONTHLY_SUFFIX))
    .at(-1);
  if (name === undefined) return undefined;
  const text = runtime.readText(planPath(root, name));
  const facts = text.ok ? factsIn(text.value) : [];
  return facts.length === 0 ? undefined : { file: `${PLAN_DIR}/${name}`, facts };
};

const usd = (value: number): string => String(Math.round(value * 100) / 100);

export const monthlySummary = (cost: MonthlyCost): string =>
  `${cost.file}: ${cost.facts.map((item) => `${item.fact} ${usd(item.base)} / ${usd(item.conservative)} USD`).join(", ")}`;
