import { isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { accept, type Parsed, reject } from "../src/core/parsed.js";

export const SESSION_CAP = 100;

export interface BenchArgs {
  readonly seed: number;
  readonly repeats: number;
  readonly tasks: readonly string[] | undefined;
  readonly arms: readonly string[] | undefined;
  readonly only: string | undefined;
  readonly model: string;
  readonly maxBudgetUsd: number;
  readonly configDir: string | undefined;
  readonly out: string | undefined;
  readonly heldout: string | undefined;
  readonly yes: boolean;
  readonly dryRun: boolean;
}

const OPTIONS = {
  seed: { type: "string" },
  repeats: { type: "string" },
  tasks: { type: "string" },
  arms: { type: "string" },
  only: { type: "string" },
  model: { type: "string" },
  "max-budget-usd": { type: "string" },
  "config-dir": { type: "string" },
  out: { type: "string" },
  heldout: { type: "string" },
  yes: { type: "boolean" },
  "dry-run": { type: "boolean" },
} as const;

const csv = (value: string | undefined): readonly string[] | undefined =>
  value === undefined ? undefined : value.split(",").filter((item) => item !== "");

const wholeNumber = (value: string | undefined, fallback: number | undefined): number | undefined => {
  if (value === undefined) return fallback;
  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : undefined;
};

export const parseBenchArgs = (argv: readonly string[]): Parsed<BenchArgs> => {
  const { values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false });
  const seed = wholeNumber(values.seed, undefined);
  if (seed === undefined) return reject("--seed <whole number> is required, so the run can be reproduced");
  const repeats = wholeNumber(values.repeats, 3);
  if (repeats === undefined || repeats < 1) return reject("--repeats must be a whole number of at least 1");
  const budget = Number.parseFloat(values["max-budget-usd"] ?? "2");
  if (!Number.isFinite(budget) || budget <= 0) return reject("--max-budget-usd must be a positive number");
  return accept({
    seed,
    repeats,
    tasks: csv(values.tasks),
    arms: csv(values.arms),
    only: values.only,
    model: values.model ?? "sonnet",
    maxBudgetUsd: budget,
    configDir: values["config-dir"],
    out: values.out,
    heldout: values.heldout,
    yes: values.yes === true,
    dryRun: values["dry-run"] === true,
  });
};

export interface RealRunCheck {
  readonly yes: boolean;
  readonly tty: boolean;
  readonly sessions: number;
  readonly unpinned: readonly string[];
  readonly configDir: string | undefined;
  readonly configHasInstructions: boolean;
}

export const realRunProblems = (check: RealRunCheck): readonly string[] => [
  ...(check.yes ? [] : ["pass --yes to spend model quota on these sessions"]),
  ...(check.tty ? [] : ["run this from a terminal: a real bench run needs a person at a TTY"]),
  ...(check.sessions > SESSION_CAP
    ? [`${String(check.sessions)} sessions is over the cap of ${String(SESSION_CAP)}`]
    : []),
  ...(check.sessions === 0 ? ["no session matches the selection"] : []),
  ...check.unpinned.map((arm) => `arm ${arm} has no pinned sha in bench/arms/${arm}.json`),
  ...(check.configDir === undefined ? ["--config-dir <dir> with a logged-in Claude Code config is required"] : []),
  ...(check.configHasInstructions ? ["the config dir has a CLAUDE.md; the bench runs without user instructions"] : []),
];

export const estimate = (sessions: number, maxBudgetUsd: number, turnsPerSession = 1): string =>
  `${String(sessions)} sessions of up to ${String(turnsPerSession)} turns, at most US$ ${(sessions * turnsPerSession * maxBudgetUsd).toFixed(2)} at --max-budget-usd ${maxBudgetUsd.toFixed(2)} per turn`;

export const pick = <T extends { readonly id: string }>(
  items: readonly T[],
  wanted: readonly string[] | undefined,
  label: string,
): Parsed<readonly T[]> => {
  if (wanted === undefined) return accept(items);
  const unknown = wanted.filter((id) => !items.some((item) => item.id === id));
  if (unknown.length > 0) return reject(`unknown ${label}: ${unknown.join(", ")}`);
  return accept(items.filter((item) => wanted.includes(item.id)));
};

export const heldoutProblem = (repo: string, heldout: string | undefined): string | undefined => {
  if (heldout === undefined) return undefined;
  const inside = relative(resolve(repo), resolve(heldout));
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))
    ? "the held-out partition must live outside this repository"
    : undefined;
};
