import type { Browser, Page } from "playwright-core";

import type { Journey, JourneyAction, JourneyOutcome, JourneyRun, Oracle, RoleTarget } from "./journey.js";
import { type FlowRequest, withPage } from "./node-flow.js";

const STEP_MS = 3000;
type Role = Parameters<Page["getByRole"]>[0];

const ROLES: readonly Role[] = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "tab",
  "menuitem",
  "heading",
];

const roleOf = (name: string): Role | undefined => ROLES.find((role) => role === name);

const locate = (page: Page, target: RoleTarget) => {
  const role = roleOf(target.role);
  if (role === undefined) throw new Error(`unsupported role ${target.role}`);
  return page.getByRole(role, { name: target.name, exact: true }).first();
};

const act = async (page: Page, request: FlowRequest, action: JourneyAction): Promise<void> => {
  if (action.kind === "goto")
    await page.goto(`${request.baseUrl}${action.route}`, { waitUntil: "networkidle", timeout: request.timeoutMs });
  else if (action.kind === "click") await locate(page, action.target).click({ timeout: STEP_MS });
  else if (action.kind === "fill") await locate(page, action.target).fill(action.value, { timeout: STEP_MS });
};

const holds = async (page: Page, oracle: Oracle): Promise<string | undefined> => {
  if (oracle.url !== undefined) {
    await page
      .waitForURL((url) => `${url.pathname}${url.search}` === oracle.url, { timeout: STEP_MS })
      .catch(() => undefined);
    const url = new URL(page.url());
    if (`${url.pathname}${url.search}` !== oracle.url)
      return `expected url ${oracle.url}, got ${url.pathname}${url.search}`;
  }
  if (oracle.text !== undefined) {
    const shown = await page
      .getByText(oracle.text)
      .first()
      .waitFor({ state: "visible", timeout: STEP_MS })
      .then(
        () => true,
        () => false,
      );
    if (!shown) return `expected text "${oracle.text}"`;
  }
  return undefined;
};

export const runJourney = async (
  browser: Browser,
  request: FlowRequest,
  journey: Journey,
  skip?: number,
): Promise<JourneyRun> =>
  withPage(browser, request, async (page) => {
    if (journey.steps[0]?.action.kind !== "goto")
      await page.goto(`${request.baseUrl}/`, { waitUntil: "networkidle", timeout: request.timeoutMs });
    for (const [index, step] of journey.steps.entries()) {
      try {
        if (index !== skip) await act(page, request, step.action);
      } catch (error) {
        const detail = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
        return { passed: false, failedAt: index, detail };
      }
      const broken = await holds(page, step.expect);
      if (broken !== undefined) return { passed: false, failedAt: index, detail: broken };
    }
    return { passed: true, failedAt: undefined, detail: "" };
  });

export const measureJourney = async (
  browser: Browser,
  request: FlowRequest,
  journey: Journey,
): Promise<JourneyOutcome> => {
  const run = await runJourney(browser, request, journey);
  const mutants: { readonly step: number; readonly killed: boolean }[] = [];
  if (run.passed) {
    for (const [step, item] of journey.steps.entries()) {
      if (item.action.kind !== "click") continue;
      mutants.push({ step, killed: !(await runJourney(browser, request, journey, step)).passed });
    }
  }
  return { name: journey.name, run, mutants };
};
