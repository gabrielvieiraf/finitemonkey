import { contrastRatio, over, parseColor, type Rgba, WHITE } from "./color.js";
import type { ProbeBox, ProbeNode, ProbeResult } from "./probe.js";
import { capPerRule, issue, type UxIssue } from "./ux.js";

export const A11Y_FEATURE = "a11y";
export const A11Y_VIEWPORTS = [320, 390, 768, 1440] as const;
export const REFLOW_WIDTH = 320;
export const TARGET_MIN = 24;
export const TARGET_OPTIONS = [24, 44, 48] as const;
export const NORMAL_TEXT_RATIO = 4.5;
export const LARGE_TEXT_RATIO = 3;
export const NON_TEXT_RATIO = 3;
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;
const BOLD = 700;

export interface A11yOptions {
  readonly target: number;
  readonly width: number;
}

export const contrastFails = (ratio: number, large: boolean): boolean =>
  ratio < (large ? LARGE_TEXT_RATIO : NORMAL_TEXT_RATIO);

export const isLargeText = (fontSize: number, fontWeight: number): boolean =>
  fontSize >= LARGE_PX || (fontSize >= LARGE_BOLD_PX && fontWeight >= BOLD);

const painted = (value: string): boolean => value !== "" && value !== "none";

export const backdropOf = (nodes: readonly ProbeNode[], at: number): Rgba | "image" => {
  const layers: Rgba[] = [];
  let index = at;
  while (index >= 0) {
    const node = nodes[index];
    if (node === undefined) break;
    if (painted(node.bgImage)) return "image";
    const color = parseColor(node.bg);
    if (color !== undefined && color.a > 0) {
      layers.push(color);
      if (color.a >= 1) break;
    }
    index = node.parent;
  }
  return layers.reverse().reduce<Rgba>((base, layer) => over(layer, base), WHITE);
};

const opacityOf = (nodes: readonly ProbeNode[], at: number): number => {
  let product = 1;
  let index = at;
  while (index >= 0) {
    const node = nodes[index];
    if (node === undefined) break;
    product *= node.opacity;
    index = node.parent;
  }
  return product;
};

const ratioText = (ratio: number): string => ratio.toFixed(3);

const contrastIssues = (nodes: readonly ProbeNode[]): readonly UxIssue[] =>
  nodes.flatMap((node, at) => {
    if (!node.visible || node.text === "") return [];
    const back = backdropOf(nodes, at);
    if (back === "image")
      return [issue("a11y/contrast", node.sel, "text over an image or gradient", { unverified: true, box: node })];
    const fore = parseColor(node.color);
    if (fore === undefined) return [];
    const alpha = fore.a * opacityOf(nodes, at);
    const ratio = contrastRatio(over({ ...fore, a: alpha }, back), back);
    const large = isLargeText(node.fontSize, node.fontWeight);
    if (!contrastFails(ratio, large)) return [];
    const need = large ? LARGE_TEXT_RATIO : NORMAL_TEXT_RATIO;
    return [issue("a11y/contrast", node.sel, `${ratioText(ratio)}:1 below ${String(need)}:1`, { box: node })];
  });

const nonTextIssues = (nodes: readonly ProbeNode[]): readonly UxIssue[] =>
  nodes.flatMap((node) => {
    if (!node.visible || !node.field || node.native) return [];
    const back = backdropOf(nodes, node.parent);
    if (back === "image") return [];
    const border = parseColor(node.borderColor);
    const fill = parseColor(node.bg);
    const edge = node.borderWidth > 0 && border !== undefined ? contrastRatio(over(border, back), back) : 0;
    const body = fill === undefined ? 0 : contrastRatio(over(fill, back), back);
    if (Math.max(edge, body) >= NON_TEXT_RATIO) return [];
    return [
      issue("a11y/non-text-contrast", node.sel, `field boundary ${ratioText(Math.max(edge, body))}:1 below 3:1`, {
        box: node,
      }),
    ];
  });

const center = (box: ProbeBox): { readonly x: number; readonly y: number } => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
});

const distanceToRect = (point: { readonly x: number; readonly y: number }, box: ProbeBox): number => {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.h));
  return Math.hypot(dx, dy);
};

const contains = (outer: ProbeBox, inner: ProbeBox): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

export const targetIssues = (
  targets: readonly (ProbeBox & { readonly sel: string })[],
  min: number,
): readonly UxIssue[] => {
  const small = (box: ProbeBox): boolean => box.w < min || box.h < min;
  if (min > TARGET_MIN)
    return targets
      .filter(small)
      .map((box) =>
        issue(
          "a11y/target-size",
          box.sel,
          `${String(Math.round(box.w))}x${String(Math.round(box.h))} below ${String(min)}px`,
          { box },
        ),
      );
  const radius = TARGET_MIN / 2;
  return targets.flatMap((target) => {
    if (!small(target)) return [];
    const middle = center(target);
    const crowded = targets.some((other) => {
      if (other === target || contains(other, target) || contains(target, other)) return false;
      if (small(other)) return Math.hypot(center(other).x - middle.x, center(other).y - middle.y) < TARGET_MIN;
      return distanceToRect(middle, other) < radius;
    });
    if (!crowded) return [];
    const size = `${String(Math.round(target.w))}x${String(Math.round(target.h))}`;
    return [
      issue("a11y/target-size", target.sel, `${size} below 24px and closer than 24px to another target`, {
        box: target,
      }),
    ];
  });
};

const nameIssues = (nodes: readonly ProbeNode[]): readonly UxIssue[] =>
  nodes.flatMap((node): readonly UxIssue[] => {
    if (!node.visible) return [];
    if (node.field && !node.labelled)
      return [
        issue(
          "a11y/label",
          node.sel,
          node.placeholder === ""
            ? "field without a label"
            : `field labelled only by placeholder "${node.placeholder}"`,
          { box: node },
        ),
      ];
    if (node.interactive && !node.field && (node.role === "button" || node.role === "link") && node.name === "")
      return [issue("a11y/name", node.sel, `${node.role} without an accessible name`, { box: node })];
    if (node.tag === "img" && node.alt === null)
      return [issue("a11y/alt", node.sel, "image without alt", { box: node })];
    return [];
  });

export const a11yIssues = (probe: ProbeResult, options: A11yOptions): readonly UxIssue[] => {
  const { nodes } = probe;
  const targets = nodes.filter((node) => node.interactive && !node.inline && !node.native);
  const reflow =
    options.width <= REFLOW_WIDTH && probe.scrollWidth > probe.clientWidth
      ? [
          issue(
            "a11y/reflow",
            "html",
            `${String(probe.scrollWidth - probe.clientWidth)}px of horizontal scroll at ${String(options.width)}px`,
          ),
        ]
      : [];
  const landmark = nodes.some((node) => node.role === "main")
    ? []
    : [issue("a11y/landmark", "body", "no main landmark")];
  return capPerRule([
    ...reflow,
    ...nodes
      .filter((node) => node.visible && node.clipped)
      .map((node) => issue("a11y/clipped-text", node.sel, `text cut off: "${node.text.slice(0, 40)}"`, { box: node })),
    ...contrastIssues(nodes),
    ...nonTextIssues(nodes),
    ...targetIssues(targets, options.target),
    ...nameIssues(nodes),
    ...landmark,
  ]);
};
