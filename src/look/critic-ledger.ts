import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { type RuleLedger, ruleLedgerOf } from "./copy-ledger.js";
import type { Critique } from "./critic.js";

export const CRITIC_STATE_FILE = "critic-classes.json";

export type CriticLedger = Readonly<Record<string, RuleLedger>>;

export const readCriticLedger = (runtime: Pick<Runtime, "readText">, paths: FmPaths): CriticLedger => {
  const text = runtime.readText(paths.cache(CRITIC_STATE_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  const root = parsed?.ok === true ? parsed.value : {};
  return Object.fromEntries(Object.entries(root).map(([heuristic, value]) => [heuristic, ruleLedgerOf(value)]));
};

const write = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, ledger: CriticLedger): void => {
  runtime.writeText(paths.cache(CRITIC_STATE_FILE), `${JSON.stringify(ledger, null, 2)}\n`);
};

export const recordShown = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  critiques: readonly Critique[],
): void => {
  if (critiques.length === 0) return;
  const ledger: Record<string, RuleLedger> = { ...readCriticLedger(runtime, paths) };
  for (const critique of critiques) {
    const old = ledger[critique.heuristic] ?? { shown: {}, accepted: [] };
    ledger[critique.heuristic] = { ...old, shown: { ...old.shown, [critique.id]: critique.text } };
  }
  write(runtime, paths, ledger);
};

export const acceptCritique = (
  runtime: Pick<Runtime, "readText" | "writeText">,
  paths: FmPaths,
  id: string,
): string | undefined => {
  const ledger = readCriticLedger(runtime, paths);
  const found = Object.entries(ledger).find(([, entry]) => id in entry.shown);
  if (found === undefined) return undefined;
  const [heuristic, entry] = found;
  if (!entry.accepted.includes(id))
    write(runtime, paths, { ...ledger, [heuristic]: { ...entry, accepted: [...entry.accepted, id] } });
  return heuristic;
};
