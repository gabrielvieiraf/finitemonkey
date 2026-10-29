import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import { classRates, readBudget } from "../policy/budget.js";
import type { Variant, VariantChange } from "../policy/evolved.js";
import { readShadow, resolveGuard } from "../policy/guards.js";
import { DAMAGE_GUARDS, type Policy } from "../policy/policy.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";

export const LOOSEN_DISMISSAL_RATE = 0.3;
export const MAX_TRIALS = 3;

export interface Proposal {
  readonly change: VariantChange;
  readonly reason: string;
}

export const changeKey = (change: VariantChange): string =>
  change.kind === "guard"
    ? `guard:${change.guard}=${change.mode}`
    : `alertBudget:${change.key}=${String(change.value)}`;

const targetOf = (change: VariantChange): string =>
  change.kind === "guard" ? `guard:${change.guard}` : `alertBudget:${change.key}`;

export const variantId = (change: VariantChange): string => `v${sha256Hex(changeKey(change)).slice(0, 8)}`;

export const proposals = (
  runtime: Pick<Runtime, "readText" | "now">,
  paths: FmPaths,
  policy: Policy,
): readonly Proposal[] => {
  const shadow = readShadow(runtime, paths);
  const rates = classRates(readBudget(runtime, paths), policy.alertBudget, nowMs(runtime));
  const damage: readonly string[] = DAMAGE_GUARDS;
  const loosen = rates.flatMap((rate): Proposal[] => {
    if (damage.includes(rate.guard) || rate.fired < policy.alertBudget.minFirings) return [];
    if (rate.rate < LOOSEN_DISMISSAL_RATE) return [];
    const resolved = resolveGuard({ id: rate.guard, damage: false }, policy, shadow);
    if (resolved.mode !== "active" || (resolved.source !== "default" && resolved.source !== "promoted")) return [];
    return [
      {
        change: { kind: "guard", guard: rate.guard, mode: "shadow" },
        reason: `dismissed ${String(rate.dismissed)} of ${String(rate.fired)} firings`,
      },
    ];
  });
  const { muteAbove, minFirings } = policy.alertBudget;
  const near = rates.filter(
    (rate) =>
      rate.fired >= minFirings && rate.rate > muteAbove / 2 && rate.rate <= muteAbove && !damage.includes(rate.guard),
  );
  const budget: Proposal[] =
    near.length === 0 || policy.alertBudgetSet.includes("muteAbove")
      ? []
      : [
          {
            change: { kind: "alertBudget", key: "muteAbove", value: Math.round((muteAbove / 2) * 100) / 100 },
            reason: `${near.map((rate) => rate.guard).join(", ")} dismissed just under the mute threshold`,
          },
        ];
  return [...loosen, ...budget];
};

export const newVariants = (
  existing: readonly Variant[],
  found: readonly Proposal[],
  born: { readonly task: string | null; readonly at: string; readonly evaluator: string },
): readonly Variant[] => {
  const seen = new Set(existing.map((variant) => changeKey(variant.change)));
  const busy = new Set(
    existing.filter((variant) => variant.status === "trial").map((variant) => targetOf(variant.change)),
  );
  const room = MAX_TRIALS - existing.filter((variant) => variant.status === "trial").length;
  const added: Variant[] = [];
  for (const proposal of found) {
    if (added.length >= room) break;
    const target = targetOf(proposal.change);
    if (seen.has(changeKey(proposal.change)) || busy.has(target)) continue;
    busy.add(target);
    added.push({
      id: variantId(proposal.change),
      change: proposal.change,
      reason: proposal.reason,
      bornTask: born.task,
      bornAt: born.at,
      evaluator: born.evaluator,
      status: "trial",
      tasks: {},
    });
  }
  return added;
};
