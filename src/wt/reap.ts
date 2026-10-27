import { pause } from "../core/pause.js";
import type { Runtime } from "../core/runtime.js";

export const REAP_GRACE_MS = 5000;
const STEP_MS = 100;

export interface Reaped {
  readonly terminated: readonly number[];
  readonly killed: readonly number[];
}

export const reap = (runtime: Runtime, pids: readonly number[], graceMs: number = REAP_GRACE_MS): Reaped => {
  const targets = [...new Set(pids)].filter((pid) => pid > 1 && runtime.signal(pid, "SIGTERM"));
  for (let waited = 0; waited < graceMs && targets.some((pid) => runtime.alive(pid)); waited += STEP_MS) {
    pause(STEP_MS);
  }
  const survivors = targets.filter((pid) => runtime.alive(pid));
  for (const pid of survivors) runtime.signal(pid, "SIGKILL");
  return { terminated: targets, killed: survivors };
};
