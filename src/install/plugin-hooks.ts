import type { JsonObject } from "../core/parsed.js";
import { INSTALLED_HOOKS } from "./hook-entries.js";
import { PLUGIN_VIA } from "./plugin-yield.js";

export const PLUGIN_NAME = "finitemonkey";
export const MARKETPLACE_NAME = "finitemonkey";
export const PLUGIN_DIR = "plugin";
export const PLUGIN_BIN = "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs";

export const pluginHooks = (): JsonObject => ({
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
