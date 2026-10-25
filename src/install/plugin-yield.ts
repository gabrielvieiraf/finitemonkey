import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { parseJsonObject } from "../core/parsed.js";
import { SETTINGS_FILE } from "./layout.js";
import { ownHandlersIn } from "./settings-merge.js";

export const PLUGIN_VIA = "plugin";

export const YIELD_STDOUT = `${JSON.stringify({ continue: true })}\n`;

export const projectOwnsHooks = (ctx: Pick<Ctx, "env" | "cwd" | "runtime">): boolean => {
  const root = ctx.env["CLAUDE_PROJECT_DIR"] ?? ctx.cwd;
  const text = ctx.runtime.readText(toAbsolutePath(join(root, ...SETTINGS_FILE.split("/"))));
  if (!text.ok) return false;
  const parsed = parseJsonObject(text.value);
  return parsed.ok && ownHandlersIn(parsed.value) > 0;
};
