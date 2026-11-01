import type { Page } from "playwright-core";

import { isRecord } from "../core/parsed.js";
import { type DialogResult, KEYBOARD_FEATURE, keyboardIssues } from "./keyboard.js";
import {
  COMPOSITES,
  focusNow,
  type FocusStop,
  type FocusTarget,
  focusTargets,
  MODALS,
  sharedContainer,
} from "./keyboard-dom.js";
import { type KeyDriver, walkKeyboard } from "./keyboard-walk.js";
import { drawBoxes, type PagePass } from "./node-ux.js";
import { runInPage } from "./probe-dom.js";

const FOCUS_SCRIPT = runInPage(focusNow.toString(), [
  "document",
  "window",
  JSON.stringify(COMPOSITES),
  JSON.stringify(MODALS),
]);
const SETTLE_MS = 150;
const INFLATE = 4;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const stopOf = (value: unknown): FocusStop | undefined => {
  if (!isRecord(value) || typeof value["sel"] !== "string") return undefined;
  return {
    sel: value["sel"],
    role: typeof value["role"] === "string" ? value["role"] : "",
    name: typeof value["name"] === "string" ? value["name"] : "",
    x: num(value["x"]),
    y: num(value["y"]),
    w: num(value["w"]),
    h: num(value["h"]),
    obscured: value["obscured"] === true,
    composite: typeof value["composite"] === "string" ? value["composite"] : null,
    modal: value["modal"] === true,
  };
};

const focused = async (page: Page): Promise<FocusStop | undefined> => stopOf(await page.evaluate(FOCUS_SCRIPT));

const targetsOf = async (page: Page, extra: readonly string[]): Promise<readonly FocusTarget[]> => {
  const composites = [COMPOSITES, ...extra].join(", ");
  const raw: unknown = await page.evaluate(
    runInPage(focusTargets.toString(), ["document", "window", JSON.stringify(composites)]),
  );
  return Array.isArray(raw)
    ? raw.flatMap((item: unknown) =>
        isRecord(item) && typeof item["sel"] === "string"
          ? [{ sel: item["sel"], composite: typeof item["composite"] === "string" ? item["composite"] : null }]
          : [],
      )
    : [];
};

const shoot = async (page: Page, stop: FocusStop): Promise<Buffer> =>
  page.screenshot({
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    clip: {
      x: Math.max(0, stop.x - INFLATE),
      y: Math.max(0, stop.y - INFLATE),
      width: stop.w + 2 * INFLATE,
      height: stop.h + 2 * INFLATE,
    },
  });

const focusShows = async (page: Page, stop: FocusStop): Promise<boolean> => {
  try {
    const on = await shoot(page, stop);
    await page.evaluate("document.activeElement && document.activeElement.blur()");
    const off = await shoot(page, stop);
    await page.evaluate(`document.querySelector(${JSON.stringify(stop.sel)})?.focus()`);
    return !on.equals(off);
  } catch {
    return true;
  }
};

const CONTAINER_SOURCE = sharedContainer.toString();

export const pageDriver = (page: Page): KeyDriver => ({
  press: async (key) => page.keyboard.press(key),
  focused: async () => focused(page),
  focus: async (sel) => {
    await page.evaluate(`document.querySelector(${JSON.stringify(sel)})?.focus()`);
  },
  reset: async () => {
    await page.evaluate("document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)");
  },
  shows: async (stop) => focusShows(page, stop),
  container: async (from, to) => {
    const raw: unknown = await page.evaluate(
      runInPage(CONTAINER_SOURCE, ["document", JSON.stringify(from), JSON.stringify(to)]),
    );
    return typeof raw === "string" ? raw : null;
  },
  targets: async (composites) => targetsOf(page, composites),
});

const dialogCheck = async (page: Page, trigger: string): Promise<DialogResult> => {
  const result = { trigger, opened: false, focusInside: false, closed: false, returned: false };
  const found = await page.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(trigger)}); if (!el) return false; el.focus(); return true; })()`,
  );
  if (found !== true) return result;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(SETTLE_MS);
  const dialogs = "dialog[open], [role=dialog], [role=alertdialog]";
  const open = `[...document.querySelectorAll(${JSON.stringify(dialogs)})].some((el) => el.getBoundingClientRect().height > 0)`;
  if ((await page.evaluate(open)) !== true) return result;
  const inside = await page.evaluate(`document.activeElement?.closest(${JSON.stringify(dialogs)}) != null`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(SETTLE_MS);
  const closed = (await page.evaluate(open)) !== true;
  const back = await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(trigger)})`);
  return { trigger, opened: true, focusInside: inside === true, closed, returned: back === true };
};

export const keyboardPass = (dialogs: Readonly<Record<string, readonly string[]>>): PagePass => ({
  feature: KEYBOARD_FEATURE,
  allWidths: false,
  run: async (page, at) => {
    const { walk, targets } = await walkKeyboard(pageDriver(page));
    await drawBoxes(page, walk.stops, at.file("focus"));
    const route = at.route.split("?")[0] ?? at.route;
    const results: DialogResult[] = [];
    for (const trigger of dialogs[route] ?? []) results.push(await dialogCheck(page, trigger));
    return keyboardIssues(walk, targets, results);
  },
});
