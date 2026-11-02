import type { HookHandlers } from "../hooks/handlers.js";
import { blueprintFirst } from "./blueprint-first.js";
import { teachPause } from "./pause.js";

export const TEACH_HANDLERS: HookHandlers = { PreToolUse: [blueprintFirst], Stop: [teachPause] };
