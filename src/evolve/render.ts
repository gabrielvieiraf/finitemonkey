import type { Translate } from "../i18n/translate.js";
import type { ArmSummary, Variant, VariantChange } from "../policy/evolved.js";

export const REVERT_COMMAND = "finitemonkey policy revert";

export const changeText = (change: VariantChange): string =>
  change.kind === "guard"
    ? `guards.${change.guard}: ${change.mode}`
    : `alertBudget.${change.key}: ${String(change.value)}`;

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;
const hours = (ms: number): string => (ms / 3_600_000).toFixed(1);
const perTask = (value: number): string => value.toFixed(1);

const numbers = (t: Translate, variant: ArmSummary, parent: ArmSummary): string =>
  t("evolve.numbers", {
    variantTasks: variant.tasks.length,
    parentTasks: parent.tasks.length,
    variantFalseDone: percent(variant.falseDone),
    parentFalseDone: percent(parent.falseDone),
    variantDismissals: perTask(variant.dismissals),
    parentDismissals: perTask(parent.dismissals),
    variantHours: hours(variant.medianWallMs),
    parentHours: hours(parent.medianWallMs),
  });

export const promotionText = (t: Translate, variant: Variant): string =>
  [
    t("evolve.promoted", { id: variant.id, change: changeText(variant.change), reason: variant.reason }),
    ...(variant.evidence === undefined ? [] : [numbers(t, variant.evidence.variant, variant.evidence.parent)]),
    t("evolve.revert", { command: `${REVERT_COMMAND} ${variant.id}` }),
  ].join(" ");

export const historyLine = (t: Translate, variant: Variant): string => {
  const head = t("evolve.history.row", {
    id: variant.id,
    status: variant.status,
    change: changeText(variant.change),
    born: variant.bornTask ?? "-",
    reason: variant.reason,
  });
  const evidence =
    variant.evidence === undefined ? [] : [numbers(t, variant.evidence.variant, variant.evidence.parent)];
  const revert =
    variant.status === "promoted" ? [t("evolve.revert", { command: `${REVERT_COMMAND} ${variant.id}` })] : [];
  return [head, ...evidence, ...revert].join(" ");
};
