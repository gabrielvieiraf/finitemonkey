import { colorDistance, hueOf, parseColor, type Rgba } from "./color.js";
import type { ProbeNode } from "./probe.js";
import { type TokenSet } from "./tokens.js";
import { capPerRule, issue, type UxIssue } from "./ux.js";

export const DS_FEATURE = "ds-adherence";
export const DEFAULT_LOOK_FEATURE = "default-look";
export const COLOR_TOLERANCE = 6;
export const LENGTH_TOLERANCE = 0.5;
export const DEFAULT_PATTERNS = ["pill", "gradient", "default-font", "emoji-icon", "same-shadow"] as const;
const VIOLET: readonly [number, number] = [240, 290];
const LARGE_AREA = 40_000;
const SHARED_SHADOW = 0.7;
const MIN_SHADOWED = 4;
const DEFAULT_FONTS = ["inter", "geist", "ui-sans-serif", "system-ui", "-apple-system", "segoe ui", "roboto"];
const EMOJI = /\p{Extended_Pictographic}/u;

export type DefaultPattern = (typeof DEFAULT_PATTERNS)[number];

export interface DsMetrics {
  readonly inside: number;
  readonly outside: number;
}

const near = (value: number, scale: readonly number[]): boolean =>
  value === 0 || scale.some((step) => Math.abs(step - value) <= LENGTH_TOLERANCE);

const colorIn = (color: Rgba, tokens: readonly Rgba[], tolerance: number): boolean =>
  color.a === 0 || tokens.some((token) => colorDistance({ ...color, a: 1 }, { ...token, a: 1 }) <= tolerance);

interface Checked {
  readonly property: string;
  readonly ok: boolean;
  readonly actual: string;
}

const colorChecks = (node: ProbeNode, tokens: TokenSet, tolerance: number): readonly Checked[] => {
  if (tokens.colors.length === 0) return [];
  const pairs: readonly [string, string, boolean][] = [
    ["color", node.color, node.text !== ""],
    ["background-color", node.bg, true],
    ["border-color", node.borderColor, node.borderWidth > 0],
  ];
  return pairs.flatMap(([property, raw, applies]) => {
    const color = applies ? parseColor(raw) : undefined;
    return color === undefined || color.a === 0
      ? []
      : [{ property, ok: colorIn(color, tokens.colors, tolerance), actual: raw }];
  });
};

const SPACING_NAMES = [
  "margin-top",
  "margin-bottom",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "row-gap",
  "column-gap",
];
const SPACING_INDEX = [0, 2, 4, 5, 6, 7, 8, 9];

const lengthChecks = (node: ProbeNode, tokens: TokenSet): readonly Checked[] => [
  ...(tokens.lengths.length === 0
    ? []
    : SPACING_INDEX.flatMap((at, index) => {
        const value = node.spacing[at] ?? 0;
        return value === 0
          ? []
          : [{ property: SPACING_NAMES[index] ?? "", ok: near(value, tokens.lengths), actual: `${String(value)}px` }];
      })),
  ...(tokens.radii.length === 0 || node.radius === 0
    ? []
    : [{ property: "border-radius", ok: near(node.radius, tokens.radii), actual: `${String(node.radius)}px` }]),
  ...(tokens.fontSizes.length === 0 || node.text === ""
    ? []
    : [{ property: "font-size", ok: near(node.fontSize, tokens.fontSizes), actual: `${String(node.fontSize)}px` }]),
  ...(tokens.fonts.length === 0 || node.text === ""
    ? []
    : [{ property: "font-family", ok: tokens.fonts.includes(firstFamily(node.fontFamily)), actual: node.fontFamily }]),
  ...(tokens.shadows.length === 0 || node.shadow === "none" || node.shadow === ""
    ? []
    : [{ property: "box-shadow", ok: tokens.shadows.includes(node.shadow), actual: node.shadow }]),
];

export const firstFamily = (raw: string): string =>
  (raw.split(",")[0] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

export const dsIssues = (
  nodes: readonly ProbeNode[],
  tokens: TokenSet,
  excluded: ReadonlySet<string>,
  tolerance = COLOR_TOLERANCE,
): { readonly issues: readonly UxIssue[]; readonly metrics: DsMetrics } => {
  const shown = nodes.filter((node) => node.visible && !excluded.has(node.sel));
  const checked = shown.map((node) => ({
    node,
    checks: [...colorChecks(node, tokens, tolerance), ...lengthChecks(node, tokens)],
  }));
  const all = checked.flatMap((entry) => entry.checks);
  const outside = checked.flatMap(({ node, checks }) =>
    checks
      .filter((check) => !check.ok)
      .map((check) =>
        issue("ds/off-token", node.sel, `${check.property} ${check.actual} is not a token`, { box: node }),
      ),
  );
  const smallest = Math.min(...tokens.fontSizes);
  const small = Number.isFinite(smallest)
    ? shown
        .filter((node) => node.text !== "" && node.fontSize > 0 && node.fontSize + LENGTH_TOLERANCE < smallest)
        .map((node) =>
          issue(
            "ds/font-small",
            node.sel,
            `font size ${String(node.fontSize)}px is below the smallest text token ${String(smallest)}px`,
            { advisory: true, box: node },
          ),
        )
    : [];
  return {
    issues: capPerRule([...outside, ...small]),
    metrics: { inside: all.filter((check) => check.ok).length, outside: all.filter((check) => !check.ok).length },
  };
};

const gradientColors = (raw: string): readonly Rgba[] =>
  [...raw.matchAll(/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/gi)].flatMap(
    (match) => parseColor(match[1] ?? "") ?? [],
  );

const violet = (color: Rgba): boolean => {
  const { hue, saturation } = hueOf(color);
  return hue >= VIOLET[0] && hue <= VIOLET[1] && saturation >= 0.3;
};

export interface PatternHit {
  readonly pattern: DefaultPattern;
  readonly node: ProbeNode;
  readonly detail: string;
}

const buttonish = (node: ProbeNode): boolean => node.visible && (node.role === "button" || node.tag === "button");

const sharedShadow = (nodes: readonly ProbeNode[]): readonly PatternHit[] => {
  const shadowed = nodes.filter((node) => node.visible && node.shadow !== "none" && node.shadow !== "");
  if (shadowed.length < MIN_SHADOWED) return [];
  const counts = new Map<string, number>();
  for (const node of shadowed) counts.set(node.shadow, (counts.get(node.shadow) ?? 0) + 1);
  const [shadow, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? ["", 0];
  const first = shadowed.find((node) => node.shadow === shadow);
  return first !== undefined && count / shadowed.length >= SHARED_SHADOW
    ? [
        {
          pattern: "same-shadow",
          node: first,
          detail: `${String(count)} of ${String(shadowed.length)} shadowed elements share one shadow`,
        },
      ]
    : [];
};

export const patternHits = (nodes: readonly ProbeNode[]): readonly PatternHit[] => {
  const body = nodes[0];
  return [
    ...nodes
      .filter((node) => buttonish(node) && node.h > 0 && node.radius >= node.h / 2)
      .map((node) => ({
        pattern: "pill" as const,
        node,
        detail: `radius ${String(node.radius)}px on a ${String(node.h)}px button`,
      })),
    ...nodes
      .filter(
        (node) =>
          node.visible &&
          node.bgImage.includes("gradient") &&
          (node.w * node.h >= LARGE_AREA || node.text !== "") &&
          gradientColors(node.bgImage).some(violet),
      )
      .map((node) => ({ pattern: "gradient" as const, node, detail: "violet or indigo gradient" })),
    ...(body !== undefined && DEFAULT_FONTS.includes(firstFamily(body.fontFamily))
      ? [
          {
            pattern: "default-font" as const,
            node: body,
            detail: `framework default font ${firstFamily(body.fontFamily)}`,
          },
        ]
      : []),
    ...nodes
      .filter((node) => node.interactive && EMOJI.test(node.name))
      .map((node) => ({ pattern: "emoji-icon" as const, node, detail: `emoji in "${node.name.slice(0, 20)}"` })),
    ...sharedShadow(nodes),
  ];
};

const contradicts = (hit: PatternHit, tokens: TokenSet): boolean => {
  if (hit.pattern === "pill")
    return tokens.radii.length > 0 && !tokens.radii.some((radius) => radius >= hit.node.h / 2);
  if (hit.pattern === "gradient")
    return (
      tokens.colors.length > 0 &&
      !gradientColors(hit.node.bgImage)
        .filter(violet)
        .every((color) => colorIn(color, tokens.colors, COLOR_TOLERANCE * 3))
    );
  if (hit.pattern === "default-font")
    return tokens.fonts.length > 0 && !tokens.fonts.includes(firstFamily(hit.node.fontFamily));
  if (hit.pattern === "same-shadow") return tokens.shadows.length > 0 && !tokens.shadows.includes(hit.node.shadow);
  return false;
};

export const defaultLookIssues = (
  nodes: readonly ProbeNode[],
  tokens: TokenSet,
  excluded: ReadonlySet<string>,
): readonly UxIssue[] =>
  capPerRule(
    patternHits(nodes)
      .filter((hit) => !excluded.has(hit.node.sel) && contradicts(hit, tokens))
      .map((hit) =>
        issue(`default-look/${hit.pattern}`, hit.node.sel, `${hit.detail}, which the project tokens do not declare`, {
          box: hit.node,
        }),
      ),
  );
