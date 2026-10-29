import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { BrowserContext, Page } from "playwright-core";

import { isRecord } from "../core/parsed.js";
import { a11yIssues, type A11yOptions } from "./a11y.js";
import { parseProbe, PROBE_SCRIPT, type ProbeBox, type ProbeResult } from "./probe.js";
import { issue, type UxIssue } from "./ux.js";

export interface PassAt {
  readonly route: string;
  readonly viewport: number;
  readonly url: string;
  readonly probe: () => Promise<ProbeResult | undefined>;
  readonly file: (suffix: string) => string;
  readonly metric: (name: string, value: number) => void;
}

export interface PagePass {
  readonly feature: string;
  readonly allWidths: boolean;
  readonly run: (page: Page, at: PassAt) => Promise<readonly UxIssue[]>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export const isLoopback = (host: string): boolean => LOOPBACK.has(host.toLowerCase());

export const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

export const blockExternal = async (context: BrowserContext, blocked: Set<string>): Promise<void> => {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    const host = hostOf(url);
    if (host === undefined || isLoopback(host) || url.startsWith("data:") || url.startsWith("blob:")) {
      await route.continue();
      return;
    }
    blocked.add(url);
    await route.abort("blockedbyclient");
  });
};

export const probeOnce = (page: Page): (() => Promise<ProbeResult | undefined>) => {
  let cached: ProbeResult | undefined;
  return async () => {
    cached ??= parseProbe(await page.evaluate(PROBE_SCRIPT));
    return cached;
  };
};

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;
export const AXE_OWN_RULES = [
  "color-contrast",
  "target-size",
  "button-name",
  "link-name",
  "label",
  "image-alt",
  "landmark-one-main",
] as const;

export const loadAxeSource = (root: string): string | undefined => {
  try {
    const main = createRequire(join(root, "package.json")).resolve("axe-core");
    const minified = join(dirname(main), "axe.min.js");
    try {
      return readFileSync(minified, "utf8");
    } catch {
      return readFileSync(main, "utf8");
    }
  } catch {
    return undefined;
  }
};

const AXE_RUN = `(async () => {
  const result = await window.axe.run(document, {
    runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} },
    rules: Object.fromEntries(${JSON.stringify(AXE_OWN_RULES)}.map((id) => [id, { enabled: false }])),
  });
  return result.violations.map((item) => ({ id: item.id, help: item.help, targets: item.nodes.map((node) => String(node.target[0])) }));
})()`;

const axeIssues = (value: unknown): readonly UxIssue[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        if (!isRecord(item) || typeof item["id"] !== "string") return [];
        const help = typeof item["help"] === "string" ? item["help"] : "";
        const targets = Array.isArray(item["targets"]) ? item["targets"] : [];
        const id = item["id"];
        return targets
          .filter((target): target is string => typeof target === "string")
          .map((target) => issue("a11y/engine", target, `${id}: ${help}`));
      })
    : [];

const engineIssues = async (page: Page, source: string | undefined, widest: boolean): Promise<readonly UxIssue[]> => {
  if (source === undefined)
    return widest
      ? [
          issue(
            "a11y/engine",
            "html",
            "axe-core is not installed; names, roles and ARIA rules beyond the built-in ones",
            { unverified: true },
          ),
        ]
      : [];
  try {
    await page.evaluate(source);
    return axeIssues(await page.evaluate(AXE_RUN));
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
    return [issue("a11y/engine", "html", `rule engine failed: ${detail}`, { unverified: true })];
  }
};

export const a11yPass = (options: Omit<A11yOptions, "width">, axe: string | undefined, widest: number): PagePass => ({
  feature: "a11y",
  allWidths: true,
  run: async (page, at) => {
    const probe = await at.probe();
    if (probe === undefined) return [issue("a11y/engine", "html", "page could not be probed", { unverified: true })];
    return [
      ...a11yIssues(probe, { ...options, width: at.viewport }),
      ...(await engineIssues(page, axe, at.viewport === widest)),
    ];
  },
});

const OVERLAY = (boxes: readonly ProbeBox[]): string => `(() => {
  const layer = document.createElement("div");
  layer.id = "__fm_overlay";
  layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
  for (const [index, box] of ${JSON.stringify(boxes)}.entries()) {
    const mark = document.createElement("div");
    mark.style.cssText = "position:absolute;border:2px solid #e00;box-sizing:border-box;left:" + (box.x - 2) + "px;top:" + (box.y - 2) + "px;width:" + (box.w + 4) + "px;height:" + (box.h + 4) + "px";
    const tag = document.createElement("span");
    tag.textContent = String(index + 1);
    tag.style.cssText = "position:absolute;left:-2px;top:-18px;background:#e00;color:#fff;font:bold 12px sans-serif;padding:0 4px";
    mark.appendChild(tag);
    layer.appendChild(mark);
  }
  document.body.appendChild(layer);
})()`;

const REMOVE_OVERLAY = `document.getElementById("__fm_overlay")?.remove()`;

export const drawBoxes = async (page: Page, boxes: readonly ProbeBox[], path: string): Promise<string | undefined> => {
  if (boxes.length === 0) return undefined;
  try {
    await page.evaluate(OVERLAY(boxes));
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await page.evaluate(REMOVE_OVERLAY);
    return path;
  } catch {
    return undefined;
  }
};
