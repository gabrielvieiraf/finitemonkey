import type { AbsolutePath } from "../core/brand.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";

export const projectRoot = (ctx: Pick<Ctx, "cwd" | "runtime">): AbsolutePath => {
  const top = ctx.runtime.git(["rev-parse", "--show-toplevel"], ctx.cwd);
  const path = top.stdout.trim();
  return top.ok && path !== "" ? toAbsolutePath(path) : ctx.cwd;
};

export const isPerson = (ctx: Pick<Ctx, "io" | "env">): boolean =>
  ctx.io.stdin.isTTY === true && ctx.env["CLAUDECODE"] === undefined && ctx.env["CLAUDE_CODE_ENTRYPOINT"] === undefined;

export const personName = (ctx: Pick<Ctx, "cwd" | "runtime" | "env">): string => {
  const name = ctx.runtime.git(["config", "user.name"], ctx.cwd).stdout.trim();
  return name !== "" ? name : (ctx.env["USER"] ?? ctx.env["USERNAME"] ?? "person");
};
