import type { JsonObject } from "../core/parsed.js";
import { INSTALLED_HOOKS } from "./hook-entries.js";
import { PLUGIN_VIA } from "./plugin-yield.js";

export const PLUGIN_NAME = "finitemonkey";
export const MARKETPLACE_NAME = "finitemonkey";
export const NEXT_MARKETPLACE_NAME = "finitemonkey-next";
export const STABLE_PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
export const NEXT_PLUGIN_ID = `${PLUGIN_NAME}@${NEXT_MARKETPLACE_NAME}`;

export const marketplaceFor = (version: string): string =>
  /^\d+\.\d+\.\d+-next\./.test(version) ? NEXT_MARKETPLACE_NAME : MARKETPLACE_NAME;
export const PLUGIN_DIR = "plugin";
export const PLUGIN_BIN = "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs";
export const PLUGIN_MOD = "./register.mjs";

export const pluginHooks = (): JsonObject => ({
  modules: [PLUGIN_MOD],
  hooks: Object.fromEntries(
    INSTALLED_HOOKS.map((spec) => [
      spec.event,
      [
        {
          hooks: [
            {
              type: "command",
              command: "node",
              args: [PLUGIN_BIN, "hook", spec.event, "--via", PLUGIN_VIA],
              timeout: spec.timeout,
              ...(spec.guard ? { onFailure: "block" } : {}),
            },
          ],
        },
      ],
    ]),
  ),
});
