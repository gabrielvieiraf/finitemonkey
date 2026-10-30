import type { JsonObject } from "../core/parsed.js";
import { marketplaceFor, NEXT_MARKETPLACE_NAME, PLUGIN_NAME } from "./plugin-hooks.js";

export const MARKETPLACE_REPO = "gabrielvieiraf/finitemonkey";
export const NEXT_BRANCH = "next";

export interface MarketplaceSource {
  readonly key: string;
  readonly pluginId: string;
  readonly entry: JsonObject;
}

export const marketplaceSource = (version: string): MarketplaceSource => {
  const key = marketplaceFor(version);
  const github = { source: "github", repo: MARKETPLACE_REPO };
  return {
    key,
    pluginId: `${PLUGIN_NAME}@${key}`,
    entry: { source: key === NEXT_MARKETPLACE_NAME ? { ...github, ref: NEXT_BRANCH } : github },
  };
};
