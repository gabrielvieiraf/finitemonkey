import type { Elements, ModElement } from "./api.js";
import { label } from "./labels.js";
import { bandLine, checkLine, type GateView, notVerifiedLine } from "./status.js";

export const GATE_PANE = "fm-gate";
export const COST_PANE = "fm-cost";

export interface PaneActions {
  readonly runGate: () => Promise<void>;
  readonly close: () => Promise<void>;
}

const line = (elements: Elements, text: string, key: string, dim = false): ModElement =>
  elements.Text({ key, children: [text], ...(dim ? { dimColor: true } : {}) });

export const bandTree = (elements: Elements, view: GateView, open: () => Promise<void>): ModElement =>
  elements.Box({
    key: "fm-band",
    flexDirection: "row",
    columnGap: 2,
    children: [
      line(elements, `FM  ${bandLine(view)}`, "fm-band-text"),
      elements.Button({ key: "fm-open", label: label("mod.view.band_button"), hotkey: "g", onPress: open }),
    ],
  });

const contractLine = (view: GateView): string =>
  view.contract === null
    ? label("mod.view.no_contract")
    : label("mod.view.contract_full", { id: view.contract.id, hash: view.contract.hash.slice(0, 12) });

export const paneTree = (elements: Elements, view: GateView, actions: PaneActions): ModElement =>
  elements.Box({
    key: "fm-pane",
    flexDirection: "column",
    children: [
      line(elements, bandLine(view), "fm-pane-summary"),
      line(elements, contractLine(view), "fm-pane-contract", true),
      ...view.checks.map((check) => line(elements, checkLine(check), `fm-check-${check.id}`)),
      ...(view.notVerified.length > 0
        ? [
            line(elements, label("mod.view.not_verified_title"), "fm-not-verified"),
            ...view.notVerified.map((item) => line(elements, notVerifiedLine(item), `fm-nv-${item.id}`)),
          ]
        : []),
      elements.Box({
        key: "fm-pane-buttons",
        flexDirection: "row",
        columnGap: 2,
        children: [
          elements.Button({
            key: "fm-run-gate",
            label: label("mod.view.run_gate"),
            hotkey: "r",
            onPress: actions.runGate,
          }),
          elements.Button({ key: "fm-close", label: label("mod.view.close"), hotkey: "x", onPress: actions.close }),
        ],
      }),
    ],
  });

export const costTree = (elements: Elements, lines: readonly string[], close: () => Promise<void>): ModElement =>
  elements.Box({
    key: "fm-cost",
    flexDirection: "column",
    children: [
      ...(lines.length === 0 ? [label("mod.view.no_cost")] : lines).map((text) => elements.Text({ children: [text] })),
      elements.Button({ key: "fm-cost-close", label: label("mod.view.close"), hotkey: "x", onPress: close }),
    ],
  });
