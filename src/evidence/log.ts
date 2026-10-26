import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";

export const logEvent = (
  runtime: Pick<Runtime, "appendText" | "now">,
  paths: FmPaths,
  event: string,
  data: JsonObject,
): boolean => runtime.appendText(paths.log, `${JSON.stringify({ at: runtime.now(), event, ...data })}\n`).ok;
