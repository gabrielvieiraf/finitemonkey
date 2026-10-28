import type { CheckKind } from "../task/types.js";

export const BLUEPRINT_TYPES = ["saas", "landing"] as const;

export type BlueprintType = (typeof BLUEPRINT_TYPES)[number];

export const AREAS = ["product", "application", "money", "quality", "security", "operation", "legal"] as const;

export type Area = (typeof AREAS)[number];

export type Probe =
  | { readonly type: "files"; readonly any: readonly string[] }
  | { readonly type: "grep"; readonly all: readonly string[] }
  | { readonly type: "deps"; readonly any: readonly string[] }
  | { readonly type: "contract"; readonly kind: CheckKind }
  | { readonly type: "manual" };

export type ProbeType = Probe["type"];

export interface BlueprintItem<Id extends string = string> {
  readonly id: Id;
  readonly area: Area;
  readonly after: readonly Id[];
  readonly probe: Probe;
}

export const parseBlueprintType = (raw: string | undefined): BlueprintType | undefined =>
  BLUEPRINT_TYPES.find((type) => type === raw?.toLowerCase());
