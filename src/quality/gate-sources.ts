import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { EXCLUDE_FM, fileAt } from "../gate/git.js";
import type { GateContext } from "../gate/types.js";
import { modeOf, readShadow } from "../policy/guards.js";
import { type GuardMode, loadPolicy } from "../policy/policy.js";
import type { QualitySources } from "./analyze.js";
import { loadTypescript } from "./ts-api.js";

export const guardMode = (ctx: Pick<GateContext, "runtime" | "paths">, id: string): GuardMode =>
  modeOf({ id, damage: false }, loadPolicy(ctx.runtime, ctx.paths.root), readShadow(ctx.runtime, ctx.paths));

export const readWorking = (ctx: Pick<GateContext, "runtime" | "paths">, file: string): string | undefined => {
  const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, file)));
  return text.ok ? text.value : undefined;
};

export const baseText = (ctx: Pick<GateContext, "git" | "base" | "changes">, file: string): string | undefined => {
  const change = ctx.changes.find((item) => item.path === file);
  if (change?.status === "A") return undefined;
  return fileAt(ctx.git, ctx.base, change?.oldPath ?? file);
};

export const changedPaths = (ctx: Pick<GateContext, "changes">): readonly string[] =>
  ctx.changes.filter((change) => change.status !== "D").map((change) => change.path);

const consumedBy = (ctx: GateContext, changed: readonly string[]) => (name: string, file: string) => {
  const found = ctx.git.out([
    "grep",
    "--untracked",
    "-l",
    "-w",
    "-F",
    "-e",
    name,
    "--",
    ".",
    `:(exclude)${file}`,
    EXCLUDE_FM,
  ]);
  if (found !== undefined && found.trim() !== "") return true;
  const word = new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`);
  return changed.some((other) => other !== file && word.test(readWorking(ctx, other) ?? ""));
};

export const qualitySources = (ctx: GateContext): QualitySources => {
  const changed = changedPaths(ctx);
  return {
    changed,
    before: (file) => baseText(ctx, file),
    after: (file) => readWorking(ctx, file),
    exists: (file) => ctx.runtime.stat(toAbsolutePath(join(ctx.paths.root, file)))?.kind === "file",
    consumed: consumedBy(ctx, changed),
    ts: loadTypescript(ctx.paths.root),
  };
};
