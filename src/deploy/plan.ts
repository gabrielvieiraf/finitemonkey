import type { DeployLevel, InfraTarget, Inventory } from "../infra/types.js";
import type { MigrationIssue } from "./migrations.js";

export const PLAN_ITEMS = ["artifact", "ci", "migrations", "health", "rollback"] as const;

export type PlanItemId = (typeof PLAN_ITEMS)[number];

export const PLAN_CHECK: Readonly<Record<PlanItemId, string>> = {
  artifact: "deploy",
  ci: "pr",
  migrations: "migrations",
  health: "runtime",
  rollback: "rollback_evidence",
};

export const PLAN_PARTS = ["artifact", "deploy", "rollback", "avoid"] as const;

export type PlanPart = (typeof PLAN_PARTS)[number];

export interface PlanItem {
  readonly id: PlanItemId;
  readonly check: string;
  readonly ok: boolean;
}

export interface DeployPlan {
  readonly level: DeployLevel;
  readonly items: readonly PlanItem[];
  readonly migrations: readonly MigrationIssue[];
}

const IMMUTABLE = new Set(["image", "static", "platform"]);

const anyTarget = (targets: readonly InfraTarget[], test: (target: InfraTarget) => boolean): boolean =>
  targets.some(test);

const itemOk = (
  id: PlanItemId,
  inventory: Inventory,
  migrations: readonly MigrationIssue[],
  evidence: string | undefined,
): boolean => {
  const targets = inventory.targets;
  switch (id) {
    case "artifact":
      return targets.length > 0 && targets.every((target) => IMMUTABLE.has(target.artifact));
    case "ci":
      return anyTarget(targets, (target) => target.waitsForCi === "yes");
    case "migrations":
      return migrations.length === 0;
    case "health":
      return anyTarget(targets, (target) => target.health === "yes");
    case "rollback":
      return evidence !== undefined;
  }
};

export const buildPlan = (
  level: DeployLevel,
  inventory: Inventory,
  migrations: readonly MigrationIssue[],
  evidence: string | undefined,
): DeployPlan => ({
  level,
  items:
    level === 0
      ? []
      : PLAN_ITEMS.map((id) => ({ id, check: PLAN_CHECK[id], ok: itemOk(id, inventory, migrations, evidence) })),
  migrations,
});
