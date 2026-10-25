import type { JsonObject } from "../core/parsed.js";
import { INSTALLED_HOOKS, npxCommand } from "./hook-entries.js";
import { PLUGIN_VIA } from "./plugin-yield.js";

export const PLUGIN_NAME = "finitemonkey";
export const MARKETPLACE_NAME = "finitemonkey";
export const PLUGIN_DIR = "plugin";

export const pluginHooks = (version: string): JsonObject => ({
  hooks: Object.fromEntries(
    INSTALLED_HOOKS.map((spec) => [
      spec.event,
      [
        {
          hooks: [
            {
              type: "command",
              command: npxCommand(version, spec.event, ["--via", PLUGIN_VIA]),
              timeout: spec.timeout,
              ...(spec.guard ? { onFailure: "block" } : {}),
            },
          ],
        },
      ],
    ]),
  ),
});
