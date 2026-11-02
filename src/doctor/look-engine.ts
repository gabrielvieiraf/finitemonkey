import { ENGINE_PACKAGE, ENGINE_SIZE_MB, hasEngine, wantsLook } from "../look/engine.js";
import { type Check, finding } from "./types.js";

export const checkLookEngine: Check = ({ root, runtime }) => {
  if (!wantsLook(runtime, root) || hasEngine(runtime, root)) return [];
  return [
    finding(
      "look.engine",
      "warn",
      "doctor.look.engine_missing",
      { package: ENGINE_PACKAGE, size: ENGINE_SIZE_MB },
      "doctor.look.fix_engine",
    ),
  ];
};
