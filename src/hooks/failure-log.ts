import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { logEvent } from "../evidence/log.js";
import { findGitRoot } from "../install/project.js";
import { maskText } from "../mask/mask.js";
import { fmPaths } from "../task/paths.js";
import type { HookEvent } from "./events.js";
import type { HookOutcome, HookVerdict } from "./runner.js";

export const HOOK_FAILURE_EVENT = "hook.failed";

const FAILURES: readonly HookVerdict[] = ["failed_open", "failed_closed", "stop_released"];

const MAX_DETAIL = 500;

export const logHookFailure = (
  ctx: Pick<Ctx, "env" | "cwd" | "runtime">,
  event: HookEvent,
  outcome: HookOutcome,
): void => {
  if (!FAILURES.includes(outcome.verdict)) return;
  const fromEnv = ctx.env["CLAUDE_PROJECT_DIR"];
  const root = fromEnv === undefined ? findGitRoot(ctx.cwd, ctx.runtime) : toAbsolutePath(fromEnv);
  if (root === undefined) return;
  const paths = fmPaths(root);
  if (ctx.runtime.stat(paths.dir)?.kind !== "dir") return;
  logEvent(ctx.runtime, paths, HOOK_FAILURE_EVENT, {
    hook: event,
    verdict: outcome.verdict,
    detail: maskText(outcome.stderr.trim()).slice(0, MAX_DETAIL),
  });
};
