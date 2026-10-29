import { backdropOf } from "./a11y.js";
import { colorDistance, hueOf, parseColor, type Rgba } from "./color.js";
import type { ProbeResult } from "./probe.js";
import { issue, type UxIssue } from "./ux.js";

export const STATES_FEATURE = "ui-states";
export const UI_STATES = ["ideal", "empty", "loading", "error", "partial"] as const;
export const LOADING_BUDGET_MS = 400;
export const STATUS_WATCH_MS = 1500;
export const SUCCESS_DISTANCE = 40;
const GREEN_HUE: readonly [number, number] = [90, 165];
const GREEN_SATURATION = 0.35;

export type UiState = (typeof UI_STATES)[number];

export interface StateSpec {
  readonly state: UiState;
  readonly mock: string | undefined;
}

export interface StatesOptions {
  readonly success: Rgba | undefined;
  readonly skeleton: string | undefined;
}

export const parseStateSpec = (entry: string): StateSpec | undefined => {
  const [name = "", mock] = entry.trim().split(/\s+/);
  const state = UI_STATES.find((item) => item === name);
  return state === undefined ? undefined : { state, mock };
};

export interface LoadingObservation {
  readonly indicator: boolean;
  readonly settledMs: number | undefined;
}

export const loadingIssues = (seen: LoadingObservation): readonly UxIssue[] =>
  seen.indicator || (seen.settledMs !== undefined && seen.settledMs <= LOADING_BUDGET_MS)
    ? []
    : [
        issue(
          "ui-states/loading",
          "body",
          `no progress indicator and no final content within ${String(LOADING_BUDGET_MS)} ms`,
        ),
      ];

const visibleText = (probe: ProbeResult): boolean => probe.nodes.some((node) => node.visible && node.text !== "");

const actions = (probe: ProbeResult): boolean =>
  probe.nodes.some((node) => node.interactive && (node.role === "button" || node.role === "link"));

export const emptyIssues = (probe: ProbeResult): readonly UxIssue[] => {
  if (visibleText(probe) && actions(probe)) return [];
  const missing = [...(visibleText(probe) ? [] : ["text"]), ...(actions(probe) ? [] : ["an action"])];
  return [issue("ui-states/empty", "main", `empty state without ${missing.join(" or ")}`)];
};

const looksGreen = (color: Rgba): boolean => {
  const { hue, saturation } = hueOf(color);
  return hue >= GREEN_HUE[0] && hue <= GREEN_HUE[1] && saturation >= GREEN_SATURATION;
};

const errorBlock = (probe: ProbeResult): number => {
  const alert = probe.nodes.findIndex((node) => node.visible && node.role === "alert");
  return alert >= 0 ? alert : probe.nodes.findIndex((node) => node.role === "main");
};

const colorIssue = (probe: ProbeResult, at: number, options: StatesOptions): readonly UxIssue[] => {
  const node = probe.nodes[at];
  if (node === undefined) return [];
  const back = backdropOf(probe.nodes, at);
  if (back === "image") return [];
  if (options.success !== undefined)
    return colorDistance(back, options.success) <= SUCCESS_DISTANCE
      ? [issue("ui-states/error-color", node.sel, "error shown in the success color", { box: node })]
      : [];
  return looksGreen(back)
    ? [
        issue("ui-states/error-color", node.sel, "error block looks like a success color (no success token declared)", {
          advisory: true,
          box: node,
        }),
      ]
    : [];
};

export const errorIssues = (probe: ProbeResult, options: StatesOptions): readonly UxIssue[] => {
  const at = errorBlock(probe);
  const selector = probe.nodes[at]?.sel ?? "body";
  return [
    ...(visibleText(probe) ? [] : [issue("ui-states/error-text", selector, "error state without text")]),
    ...(actions(probe) ? [] : [issue("ui-states/error-action", selector, "error state without a recovery action")]),
    ...colorIssue(probe, at, options),
  ];
};

export const partialIssues = (probe: ProbeResult): readonly UxIssue[] => [
  ...(probe.scrollWidth > probe.clientWidth
    ? [issue("ui-states/partial", "html", `${String(probe.scrollWidth - probe.clientWidth)}px of horizontal overflow`)]
    : []),
  ...probe.nodes
    .filter((node) => node.visible && node.clipped)
    .map((node) => issue("ui-states/partial", node.sel, `text cut off: "${node.text.slice(0, 40)}"`, { box: node })),
];

export const statusIssues = (changed: readonly string[]): readonly UxIssue[] =>
  changed.map((selector) =>
    issue("ui-states/status", selector, "content changes without a live region, role=status or role=alert"),
  );

export const notCovered = (spec: StateSpec): UxIssue =>
  issue("ui-states/not-covered", "body", `state "${spec.state}" is required and has no mock`);

export const stateIssues = (spec: StateSpec, probe: ProbeResult, options: StatesOptions): readonly UxIssue[] => {
  if (spec.state === "empty") return emptyIssues(probe);
  if (spec.state === "error") return errorIssues(probe, options);
  if (spec.state === "partial") return partialIssues(probe);
  return [];
};

export const optionsOf = (success: string | undefined, skeleton: string | undefined): StatesOptions => ({
  success: success === undefined ? undefined : parseColor(success),
  skeleton,
});
