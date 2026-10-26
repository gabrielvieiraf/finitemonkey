import type { AcceptanceCheck, TaskContract } from "../task/types.js";
import { type SizeVerdict, upgraded } from "./size.js";

export const REVIEW_CHECK = "size-review";
export const INVENTORY_CHECK = "size-inventory";
export const DECISION_CHECK = "size-decision";

const INVENTORY = "inventory of the files, behaviours and callers the change touches";
const DECISION = "a recorded decision on the approach for a change this large";

const reviewChecks = (verdict: SizeVerdict): readonly AcceptanceCheck[] =>
  verdict.effective === "S" ? [] : [{ id: REVIEW_CHECK, kind: "review" }];

const largeChecks = (verdict: SizeVerdict): readonly AcceptanceCheck[] =>
  verdict.effective === "L" && verdict.declared !== "S"
    ? [
        { id: INVENTORY_CHECK, kind: "manual", description: INVENTORY },
        { id: DECISION_CHECK, kind: "manual", description: DECISION },
      ]
    : [];

export const sizeRequirements = (verdict: SizeVerdict): readonly AcceptanceCheck[] => [
  ...reviewChecks(verdict),
  ...largeChecks(verdict),
];

export const applySize = (contract: TaskContract, verdict: SizeVerdict): TaskContract => {
  if (contract.implicit) return contract;
  const declaredIds = new Set(contract.acceptance.map((check) => check.id));
  const declaredKinds = new Set(contract.acceptance.map((check) => check.kind));
  const extra = sizeRequirements(verdict).filter(
    (check) => !declaredIds.has(check.id) && !(check.kind === "review" && declaredKinds.has("review")),
  );
  return extra.length === 0 && !upgraded(verdict)
    ? contract
    : { ...contract, size: verdict.effective, acceptance: [...contract.acceptance, ...extra] };
};
