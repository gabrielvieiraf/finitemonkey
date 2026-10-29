import type { ProbeNode, ProbeResult } from "./probe.js";
import type { TokenName, TokenSet } from "./tokens.js";

export const SHEET_FEATURE = "ui-sheet";
export const SHEET_SCHEMA = "finitemonkey/look-sheet@1";
export const SHEET_WIDTHS = [320, 390, 768, 1440] as const;
export const MAX_ELEMENTS = 60;
export const UNMEASURED = "[unmeasured]";
const TOLERANCE = 0.5;
const FILL_SLACK = 2;

export const SIDES = ["top", "right", "bottom", "left"] as const;
export type Kind = "space" | "radius" | "border";

export interface SheetVariable {
  readonly name: string;
  readonly kind: Kind;
  readonly px: number;
  readonly token: string | undefined;
  readonly offScale: boolean;
}

export interface SheetElement {
  readonly key: string;
  readonly slot: string;
  readonly depth: number;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly values: Readonly<Record<string, number | null>>;
  readonly layer: string | undefined;
}

export interface SheetView {
  readonly width: number;
  readonly state: string;
  readonly placement: { readonly x: number; readonly w: number; readonly fill: boolean } | null;
  readonly elements: readonly SheetElement[];
}

export interface SheetIssue {
  readonly rule: "sheet/off-scale" | "sheet/nested-radius";
  readonly key: string;
  readonly detail: string;
}

export interface Sheet {
  readonly schema: typeof SHEET_SCHEMA;
  readonly route: string;
  readonly selector: string;
  readonly tree: string;
  readonly views: readonly SheetView[];
  readonly variables: readonly SheetVariable[];
  readonly issues: readonly SheetIssue[];
}

export interface MeasuredView {
  readonly width: number;
  readonly state: string;
  readonly probe: ProbeResult | undefined;
  readonly root: string | undefined;
}

const PROPERTIES: readonly { readonly name: string; readonly kind: Kind; readonly at: (node: ProbeNode) => number }[] =
  [
    ...SIDES.map((side, index) => ({
      name: `padding-${side}`,
      kind: "space" as const,
      at: (node: ProbeNode) => node.spacing[4 + index] ?? 0,
    })),
    { name: "row-gap", kind: "space", at: (node) => node.spacing[8] ?? 0 },
    { name: "column-gap", kind: "space", at: (node) => node.spacing[9] ?? 0 },
    { name: "radius", kind: "radius", at: (node) => node.radius },
    { name: "border", kind: "border", at: (node) => node.borderWidth },
  ];

const subtree = (
  nodes: readonly ProbeNode[],
  root: number,
): readonly { readonly index: number; readonly depth: number }[] => {
  const depthOf = new Map<number, number>([[root, 0]]);
  const out = [{ index: root, depth: 0 }];
  nodes.forEach((node, index) => {
    const parentDepth = depthOf.get(node.parent);
    if (index === root || parentDepth === undefined || !node.visible || out.length >= MAX_ELEMENTS) return;
    depthOf.set(index, parentDepth + 1);
    out.push({ index, depth: parentDepth + 1 });
  });
  return out;
};

const slotOf = (node: ProbeNode, parent: ProbeNode | undefined): string => {
  const role = (node.role !== "" ? node.role : node.tag).toUpperCase();
  const room = parent === undefined ? undefined : parent.w - (parent.spacing[5] ?? 0) - (parent.spacing[7] ?? 0);
  const fill = room !== undefined && Math.abs(node.w - room) <= FILL_SLACK;
  return `${role} · ${fill ? "FILL" : "HUG"}`;
};

const layerOf = (node: ProbeNode): string | undefined =>
  node.position === "fixed" || node.position === "sticky" || node.position === "absolute" ? node.position : undefined;

const viewOf = (view: MeasuredView): SheetView => {
  const nodes = view.probe?.nodes ?? [];
  const rootIndex = nodes.findIndex((node) => node.sel === view.root);
  const root = nodes[rootIndex];
  if (!root?.visible) return { width: view.width, state: view.state, placement: null, elements: [] };
  const elements = subtree(nodes, rootIndex).flatMap(({ index, depth }) => {
    const node = nodes[index];
    if (node === undefined) return [];
    return [
      {
        key: node.sel,
        slot: slotOf(node, nodes[node.parent]),
        depth,
        box: { x: node.x - root.x, y: node.y - root.y, w: node.w, h: node.h },
        values: Object.fromEntries(PROPERTIES.map((property) => [property.name, property.at(node)])),
        layer: layerOf(node),
      },
    ];
  });
  return {
    width: view.width,
    state: view.state,
    placement: { x: root.x, w: root.w, fill: Math.abs(root.w - view.width) <= FILL_SLACK * 10 },
    elements,
  };
};

const tokenFor = (names: readonly TokenName[], kind: Kind, px: number): TokenName | undefined =>
  names.find(
    (name) =>
      (kind === "radius" ? name.kind === "radius" : name.kind === "space") && Math.abs(name.px - px) <= TOLERANCE,
  );

export const variablesOf = (views: readonly SheetView[], tokens: TokenSet): readonly SheetVariable[] => {
  const seen = new Map<string, SheetVariable>();
  const counters: Record<Kind, number> = { space: 0, radius: 0, border: 0 };
  const prefix: Readonly<Record<Kind, string>> = { space: "S", radius: "R", border: "B" };
  for (const view of views)
    for (const element of view.elements)
      for (const property of PROPERTIES) {
        const px = element.values[property.name];
        if (px === undefined || px === null || px === 0 || seen.has(`${property.kind}:${String(px)}`)) continue;
        counters[property.kind] += 1;
        const token = property.kind === "border" ? undefined : tokenFor(tokens.names, property.kind, px);
        const scaled =
          property.kind === "border"
            ? true
            : tokens.names.some((name) => name.kind === (property.kind === "radius" ? "radius" : "space"));
        seen.set(`${property.kind}:${String(px)}`, {
          name: `${prefix[property.kind]}${String(counters[property.kind])}`,
          kind: property.kind,
          px,
          token: token?.name,
          offScale: property.kind !== "border" && scaled && token === undefined,
        });
      }
  return [...seen.values()];
};

export const nestedRadiusIssues = (views: readonly SheetView[]): readonly SheetIssue[] =>
  views.flatMap((view) =>
    view.elements.flatMap((outer) =>
      view.elements
        .filter(
          (inner) =>
            inner.depth === outer.depth + 1 && (inner.values["radius"] ?? 0) > 0 && (outer.values["radius"] ?? 0) > 0,
        )
        .flatMap((inner) => {
          const border = outer.values["border"] ?? 0;
          const padLeft = outer.values["padding-left"] ?? 0;
          const padTop = outer.values["padding-top"] ?? 0;
          const atCorner =
            Math.abs(inner.box.x - outer.box.x - border - padLeft) <= 1 &&
            Math.abs(inner.box.y - outer.box.y - border - padTop) <= 1;
          if (!atCorner) return [];
          const expected = Math.max(0, (outer.values["radius"] ?? 0) - border - Math.min(padLeft, padTop));
          const actual = inner.values["radius"] ?? 0;
          return Math.abs(actual - expected) <= TOLERANCE
            ? []
            : [
                {
                  rule: "sheet/nested-radius" as const,
                  key: inner.key,
                  detail: `inner radius ${String(actual)}px, expected ${String(expected)}px (outer ${String(outer.values["radius"] ?? 0)} − border ${String(border)} − padding ${String(Math.min(padLeft, padTop))}) at ${String(view.width)}px`,
                },
              ];
        }),
    ),
  );

export const buildSheet = (input: {
  readonly route: string;
  readonly selector: string;
  readonly tree: string;
  readonly views: readonly MeasuredView[];
  readonly tokens: TokenSet;
}): Sheet => {
  const views = input.views.map(viewOf);
  const variables = variablesOf(views, input.tokens);
  const offScale = variables
    .filter((variable) => variable.offScale)
    .map((variable) => {
      const where = views
        .flatMap((view) => view.elements)
        .find((element) => Object.values(element.values).includes(variable.px));
      return {
        rule: "sheet/off-scale" as const,
        key: where?.key ?? input.selector,
        detail: `${variable.name} = ${String(variable.px)}px matches no ${variable.kind} token`,
      };
    });
  return {
    schema: SHEET_SCHEMA,
    route: input.route,
    selector: input.selector,
    tree: input.tree,
    views,
    variables,
    issues: [...offScale, ...nestedRadiusIssues(views)],
  };
};

export interface DimensionChange {
  readonly width: number;
  readonly state: string;
  readonly key: string;
  readonly property: string;
  readonly from: number | null;
  readonly to: number | null;
}

export const diffSheets = (before: Sheet, after: Sheet): readonly DimensionChange[] =>
  after.views.flatMap((view) => {
    const old = before.views.find((item) => item.width === view.width && item.state === view.state);
    if (old === undefined) return [];
    const keys = [
      ...new Set([...old.elements.map((element) => element.key), ...view.elements.map((element) => element.key)]),
    ];
    return keys.flatMap((key) => {
      const was = old.elements.find((element) => element.key === key);
      const now = view.elements.find((element) => element.key === key);
      return PROPERTIES.flatMap((property) => {
        const from = was?.values[property.name] ?? null;
        const to = now?.values[property.name] ?? null;
        return from === to ? [] : [{ width: view.width, state: view.state, key, property: property.name, from, to }];
      });
    });
  });
