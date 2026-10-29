import type { ModApi } from "./api.js";
import type { On, SessionStartInput, SessionStartResult } from "./events.js";

async function onStart(
  _$: ModApi,
  e: SessionStartInput,
  next: (e: SessionStartInput) => Promise<SessionStartResult>,
): Promise<SessionStartResult> {
  return next(e);
}

export function register(on: On): void {
  on("session.start", onStart);
}
