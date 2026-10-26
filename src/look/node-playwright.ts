import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type * as Playwright from "playwright-core";

import { isRecord } from "../core/parsed.js";

export type PlaywrightModule = typeof Playwright;

const NAMES = ["playwright", "playwright-core"] as const;

const isPlaywright = (value: unknown): value is PlaywrightModule =>
  isRecord(value) && isRecord(value["chromium"]) && typeof value["chromium"]["launch"] === "function";

const unwrap = (value: unknown): unknown =>
  isRecord(value) && !("chromium" in value) && isRecord(value["default"]) ? value["default"] : value;

const tryLoad = async (base: string, name: string): Promise<PlaywrightModule | undefined> => {
  try {
    const resolved = createRequire(base).resolve(name);
    const loaded: unknown = unwrap(await import(pathToFileURL(resolved).href));
    return isPlaywright(loaded) ? loaded : undefined;
  } catch {
    return undefined;
  }
};

export const loadPlaywright = async (root: string): Promise<PlaywrightModule | undefined> => {
  for (const base of [join(root, "package.json"), fileURLToPath(import.meta.url)]) {
    for (const name of NAMES) {
      const found = await tryLoad(base, name);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

export const launchBrowser = async (playwright: PlaywrightModule): Promise<Playwright.Browser | undefined> => {
  for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await playwright.chromium.launch({ headless: true, ...options });
    } catch {
      continue;
    }
  }
  return undefined;
};
