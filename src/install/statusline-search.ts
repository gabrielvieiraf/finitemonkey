import type { Env } from "../core/context.js";
import type { JsonObject } from "../core/parsed.js";
import { userSettingsText } from "./detect.js";
import type { Project } from "./project.js";
import { statusLineCommand, statusLineIn } from "./statusline.js";

export const LOCAL_SETTINGS_FILE = ".claude/settings.local.json";

export const existingStatusLine = (project: Project, projectSettings: JsonObject, env: Env): string | undefined =>
  statusLineCommand(projectSettings["statusLine"]) ??
  statusLineCommand(statusLineIn(project.read(LOCAL_SETTINGS_FILE))) ??
  statusLineCommand(statusLineIn(userSettingsText(project, env)));
