import type { FocusStop, FocusTarget } from "./keyboard-dom.js";
import { capPerRule, issue, type UxIssue } from "./ux.js";

export const KEYBOARD_FEATURE = "keyboard";
export const MAX_STOPS = 60;
const ORDER_SLACK_PX = 8;

export interface ObservedStop extends FocusStop {
  readonly changed: boolean;
}

export interface Trap {
  readonly cycle: readonly string[];
  readonly escaped: boolean;
  readonly modal: boolean;
}

export interface KeyboardWalk {
  readonly stops: readonly ObservedStop[];
  readonly complete: boolean;
  readonly trap: Trap | undefined;
}

export interface DialogResult {
  readonly trigger: string;
  readonly opened: boolean;
  readonly focusInside: boolean;
  readonly closed: boolean;
  readonly returned: boolean;
}

const unreachable = (walk: KeyboardWalk, targets: readonly FocusTarget[]): readonly UxIssue[] => {
  if (!walk.complete || walk.trap !== undefined) return [];
  const reached = new Set(walk.stops.map((stop) => stop.sel));
  const groups = new Set(walk.stops.flatMap((stop) => (stop.composite === null ? [] : [stop.composite])));
  return targets
    .filter((target) => !reached.has(target.sel) && (target.composite === null || !groups.has(target.composite)))
    .map((target) => issue("keyboard/unreachable", target.sel, "never receives focus with Tab"));
};

const trapped = (walk: KeyboardWalk): readonly UxIssue[] => {
  const trap = walk.trap;
  if (trap === undefined || trap.escaped || trap.modal) return [];
  const first = trap.cycle[0] ?? "body";
  return [
    issue(
      "keyboard/trap",
      first,
      `focus cycles among ${String(trap.cycle.length)} elements and Shift+Tab cannot leave`,
    ),
  ];
};

const orderIssues = (stops: readonly ObservedStop[]): readonly UxIssue[] => {
  const jumps = stops.flatMap((stop, index) => {
    const before = stops[index - 1];
    return before !== undefined && stop.y + ORDER_SLACK_PX < before.y && stop.y + stop.h <= before.y ? [index] : [];
  });
  const first = jumps[0] === undefined ? undefined : stops[jumps[0]];
  if (first === undefined) return [];
  const listed = jumps.slice(0, 5).map((index) => `#${String(index)} → #${String(index + 1)}`);
  const detail = `focus moves up the page ${String(jumps.length)} times: ${listed.join(", ")}`;
  return [issue("keyboard/order", first.sel, detail, { advisory: true })];
};

export const dialogIssues = (results: readonly DialogResult[]): readonly UxIssue[] =>
  results.flatMap((result) => {
    const problems = [
      ...(result.opened ? [] : ["did not open from the keyboard"]),
      ...(result.opened && !result.focusInside ? ["focus did not move inside"] : []),
      ...(result.opened && !result.closed ? ["Escape did not close it"] : []),
      ...(result.opened && result.closed && !result.returned ? ["focus did not return to the trigger"] : []),
    ];
    return problems.length === 0 ? [] : [issue("keyboard/dialog", result.trigger, problems.join("; "))];
  });

export const keyboardIssues = (
  walk: KeyboardWalk,
  targets: readonly FocusTarget[],
  dialogs: readonly DialogResult[],
): readonly UxIssue[] =>
  capPerRule([
    ...unreachable(walk, targets),
    ...trapped(walk),
    ...walk.stops
      .filter((stop) => !stop.changed && !stop.obscured)
      .map((stop) =>
        issue("keyboard/focus-invisible", stop.sel, "focus changes no pixel of the element", { box: stop }),
      ),
    ...walk.stops
      .filter((stop) => stop.obscured)
      .map((stop) =>
        issue("keyboard/focus-obscured", stop.sel, "focused element is under a fixed or sticky element", { box: stop }),
      ),
    ...orderIssues(walk.stops),
    ...dialogIssues(dialogs),
  ]);
