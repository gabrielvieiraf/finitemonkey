import { type KeyboardWalk, MAX_STOPS, type ObservedStop, type Trap } from "./keyboard.js";
import type { FocusStop, FocusTarget } from "./keyboard-dom.js";

export const MAX_COMPOSITE_PROBES = 20;
export const ARROW_KEYS = ["ArrowDown", "ArrowRight"] as const;
const ARROW_OWNERS = new Set(["textbox", "combobox", "slider", "spinbutton", "searchbox", "radio"]);

export interface KeyDriver {
  readonly press: (key: string) => Promise<void>;
  readonly focused: () => Promise<FocusStop | undefined>;
  readonly focus: (sel: string) => Promise<void>;
  readonly reset: () => Promise<void>;
  readonly shows: (stop: FocusStop) => Promise<boolean>;
  readonly container: (from: string, to: string) => Promise<string | null>;
  readonly targets: (composites: readonly string[]) => Promise<readonly FocusTarget[]>;
}

const escapes = async (driver: KeyDriver, cycle: readonly string[]): Promise<boolean> => {
  const inside = new Set(cycle);
  for (let step = 0; step <= cycle.length; step += 1) {
    await driver.press("Shift+Tab");
    const now = await driver.focused();
    if (now === undefined || !inside.has(now.sel)) return true;
  }
  return false;
};

const trapOf = async (
  driver: KeyDriver,
  stops: readonly ObservedStop[],
  repeat: FocusStop,
): Promise<Trap | undefined> => {
  const start = stops.findIndex((stop) => stop.sel === repeat.sel);
  if (start <= 0) return undefined;
  const cycle = stops.slice(start).map((stop) => stop.sel);
  return { cycle, escaped: await escapes(driver, cycle), modal: repeat.modal };
};

export const walkForward = async (driver: KeyDriver, limit = MAX_STOPS): Promise<KeyboardWalk> => {
  await driver.reset();
  const stops: ObservedStop[] = [];
  for (let step = 0; step < limit + 2; step += 1) {
    await driver.press("Tab");
    const now = await driver.focused();
    if (now === undefined) {
      if (stops.length > 0) return { stops, complete: true, trap: undefined };
      continue;
    }
    if (stops.some((stop) => stop.sel === now.sel)) {
      const trap = await trapOf(driver, stops, now);
      return { stops, complete: trap === undefined, trap };
    }
    if (stops.length >= limit) return { stops, complete: false, trap: undefined };
    stops.push({ ...now, changed: await driver.shows(now) });
  }
  return { stops, complete: false, trap: undefined };
};

export const walkBackward = async (driver: KeyDriver, stops: readonly ObservedStop[]): Promise<readonly string[]> => {
  const last = stops[stops.length - 1];
  if (last === undefined) return [];
  await driver.focus(last.sel);
  const seen: string[] = [last.sel];
  for (let step = 0; step <= stops.length; step += 1) {
    await driver.press("Shift+Tab");
    const now = await driver.focused();
    if (now === undefined || seen.includes(now.sel)) return seen;
    seen.push(now.sel);
  }
  return seen;
};

const arrowContainer = async (driver: KeyDriver, stop: ObservedStop): Promise<string | undefined> => {
  for (const key of ARROW_KEYS) {
    await driver.focus(stop.sel);
    await driver.press(key);
    const now = await driver.focused();
    if (now === undefined || now.sel === stop.sel) continue;
    const box = await driver.container(stop.sel, now.sel);
    if (box !== null) return box;
  }
  return undefined;
};

export const behaviorComposites = async (
  driver: KeyDriver,
  stops: readonly ObservedStop[],
): Promise<ReadonlyMap<string, string>> => {
  const found = new Map<string, string>();
  const candidates = stops.filter((stop) => stop.composite === null && !ARROW_OWNERS.has(stop.role));
  for (const stop of candidates.slice(0, MAX_COMPOSITE_PROBES)) {
    const box = await arrowContainer(driver, stop);
    if (box !== undefined) found.set(stop.sel, box);
  }
  return found;
};

export interface FullWalk {
  readonly walk: KeyboardWalk;
  readonly targets: readonly FocusTarget[];
}

export const walkKeyboard = async (driver: KeyDriver, limit = MAX_STOPS): Promise<FullWalk> => {
  const forward = await walkForward(driver, limit);
  if (!forward.complete || forward.trap !== undefined) return { walk: forward, targets: await driver.targets([]) };
  const reverse = await walkBackward(driver, forward.stops);
  const groups = await behaviorComposites(driver, forward.stops);
  const stops = forward.stops.map((stop) => ({ ...stop, composite: groups.get(stop.sel) ?? stop.composite }));
  return { walk: { ...forward, stops, reverse }, targets: await driver.targets([...new Set(groups.values())]) };
};
