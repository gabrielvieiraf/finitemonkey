import type { Runtime } from "./runtime.js";

export const nowMs = (runtime: Pick<Runtime, "now">): number => Date.parse(runtime.now());
