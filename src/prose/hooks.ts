import type { HookHandlers } from "../hooks/handlers.js";
import { proseMarkerGuard } from "./marker-guard.js";
import { proseCommandGuard } from "./text-guard.js";

export const PROSE_HANDLERS: HookHandlers = {
  PreToolUse: [proseMarkerGuard, proseCommandGuard],
};
