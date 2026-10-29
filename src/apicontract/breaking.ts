import type { ApiRegistry, Endpoint, Field } from "./registry.js";
import type { ApiShape } from "./shape.js";

export const API_BREAKING_FEATURE = "api-breaking";

export type BreakingChange =
  | { readonly kind: "endpoint_removed"; readonly id: string; readonly route: string }
  | { readonly kind: "endpoint_moved"; readonly id: string; readonly from: string; readonly to: string }
  | { readonly kind: "output_removed"; readonly id: string; readonly field: string }
  | { readonly kind: "output_narrowed"; readonly id: string; readonly field: string; readonly change: string }
  | { readonly kind: "input_required"; readonly id: string; readonly field: string }
  | { readonly kind: "input_narrowed"; readonly id: string; readonly field: string; readonly change: string }
  | { readonly kind: "status_removed"; readonly id: string; readonly status: number };

export interface ContractSide {
  readonly registry: ApiRegistry;
  readonly shape: ApiShape;
}

const routeOf = (endpoint: Endpoint): string => `${endpoint.method} ${endpoint.path}`;

const typeText = (field: Field): string => `${field.type}${field.optional ? "?" : ""}`;

const outputChanges = (id: string, before: Endpoint, after: Endpoint): readonly BreakingChange[] =>
  before.output.flatMap((old): BreakingChange[] => {
    const now = after.output.find((field) => field.name === old.name);
    if (now === undefined) return [{ kind: "output_removed", id, field: old.name }];
    const narrowed = now.type !== old.type || (now.optional && !old.optional);
    return narrowed
      ? [{ kind: "output_narrowed", id, field: old.name, change: `${typeText(old)} -> ${typeText(now)}` }]
      : [];
  });

const inputChanges = (id: string, before: Endpoint, after: Endpoint): readonly BreakingChange[] =>
  after.input.flatMap((now): BreakingChange[] => {
    const old = before.input.find((field) => field.name === now.name);
    if (old === undefined) return now.optional ? [] : [{ kind: "input_required", id, field: now.name }];
    if (old.optional && !now.optional) return [{ kind: "input_required", id, field: now.name }];
    return old.type === now.type
      ? []
      : [{ kind: "input_narrowed", id, field: now.name, change: `${typeText(old)} -> ${typeText(now)}` }];
  });

const statusChanges = (id: string, base: ContractSide, head: ContractSide): readonly BreakingChange[] => {
  const after = head.shape.endpoints.get(id)?.status ?? [];
  if (after.length === 0) return [];
  return (base.shape.endpoints.get(id)?.status ?? [])
    .filter((code) => !after.includes(code))
    .map((status) => ({ kind: "status_removed", id, status }));
};

const unpublished = (side: ContractSide, id: string): boolean =>
  (side.shape.endpoints.get(id)?.stability ?? "public") !== "public";

export const breakingChanges = (base: ContractSide, head: ContractSide): readonly BreakingChange[] =>
  base.registry.endpoints.flatMap((before): readonly BreakingChange[] => {
    if (unpublished(base, before.id)) return [];
    const after = head.registry.endpoints.find((endpoint) => endpoint.id === before.id);
    if (after === undefined) return [{ kind: "endpoint_removed", id: before.id, route: routeOf(before) }];
    if (unpublished(head, after.id)) return [];
    const moved: readonly BreakingChange[] =
      routeOf(before) === routeOf(after)
        ? []
        : [{ kind: "endpoint_moved", id: before.id, from: routeOf(before), to: routeOf(after) }];
    return [
      ...moved,
      ...outputChanges(before.id, before, after),
      ...inputChanges(before.id, before, after),
      ...statusChanges(before.id, base, head),
    ];
  });

export const versionBumped = (base: ContractSide, head: ContractSide): boolean =>
  head.shape.version !== undefined && head.shape.version !== base.shape.version;
