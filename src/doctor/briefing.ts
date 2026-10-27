import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { BRIEFING_FILE, BRIEFING_MAX_LINES, lineCount } from "../fronts/brief.js";
import { type Check, finding } from "./types.js";

export const checkBriefing: Check = (env) => {
  const text = env.runtime.readText(toAbsolutePath(join(env.root, BRIEFING_FILE)));
  if (!text.ok) return [];
  const lines = lineCount(text.value);
  return lines > BRIEFING_MAX_LINES
    ? [
        finding(
          "briefing",
          "warn",
          "doctor.briefing.long",
          { lines, ceiling: BRIEFING_MAX_LINES },
          "doctor.briefing.fix",
        ),
      ]
    : [finding("briefing", "ok", "doctor.briefing.ok", { lines, ceiling: BRIEFING_MAX_LINES })];
};
