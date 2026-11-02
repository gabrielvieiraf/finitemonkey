import type { JsonObject } from "../core/parsed.js";
import { MARKETPLACE_NAME, marketplaceFor, NEXT_MARKETPLACE_NAME, PLUGIN_NAME } from "./plugin-hooks.js";

export const MARKETPLACE_REPO = "gabrielvieiraf/finitemonkey";
export const NEXT_BRANCH = "next";

export const CHANNELS = ["stable", "next"] as const;

export type Channel = (typeof CHANNELS)[number];

export const parseChannel = (raw: string | undefined): Channel | undefined =>
  CHANNELS.find((channel) => channel === raw);

const keyFor = (version: string, channel: Channel | undefined): string =>
  channel === undefined ? marketplaceFor(version) : channel === "next" ? NEXT_MARKETPLACE_NAME : MARKETPLACE_NAME;

export interface MarketplaceSource {
  readonly key: string;
  readonly pluginId: string;
  readonly entry: JsonObject;
}

export const marketplaceSource = (version: string, channel?: Channel): MarketplaceSource => {
  const key = keyFor(version, channel);
  const github = { source: "github", repo: MARKETPLACE_REPO };
  return {
    key,
    pluginId: `${PLUGIN_NAME}@${key}`,
    entry: { source: key === NEXT_MARKETPLACE_NAME ? { ...github, ref: NEXT_BRANCH } : github },
  };
};

export const chosenMarketplace = (version: string, choice: boolean | Channel): MarketplaceSource | undefined =>
  choice === false ? undefined : marketplaceSource(version, choice === true ? undefined : choice);
