import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";

const MIN_SLICE_MS = 1;

export const boundedRuntime = (runtime: Runtime, deadlineAt: number): Runtime => {
  const remaining = (): number => Math.max(MIN_SLICE_MS, deadlineAt - nowMs(runtime));
  const capped = (wanted: number | undefined): number => Math.min(wanted ?? Number.POSITIVE_INFINITY, remaining());
  return {
    ...runtime,
    git: (args, cwd, timeoutMs) => runtime.git(args, cwd, capped(timeoutMs)),
    gitWith: (args, cwd, options) => runtime.gitWith(args, cwd, { ...options, timeoutMs: capped(options.timeoutMs) }),
    exec: (request) => runtime.exec({ ...request, timeoutMs: capped(request.timeoutMs) }),
    execSelf: (args, cwd, timeoutMs) => runtime.execSelf(args, cwd, capped(timeoutMs)),
  };
};
