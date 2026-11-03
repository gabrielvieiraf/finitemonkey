import type { Ctx } from "../core/context.js";
import type { CommandResult } from "../core/result.js";
import { openProject } from "../install/session.js";
import { adoptWorktrees } from "../wt/adopt.js";
import { unregisteredWorktrees } from "../wt/adopt-offer.js";
import { commandOwner } from "./wt.js";

export interface AdoptOffer {
  readonly unregistered: readonly string[];
  readonly adopted: number;
}

export const adoptOffer = (ctx: Ctx, adopt: boolean): AdoptOffer => {
  const root = openProject(ctx).project.root;
  const unregistered = unregisteredWorktrees(ctx.runtime, root);
  if (unregistered.length === 0 || !adopt || ctx.dryRun) return { unregistered, adopted: 0 };
  const adopted = adoptWorktrees(ctx.runtime, ctx.cwd, commandOwner(ctx));
  return { unregistered, adopted: adopted.ok ? adopted.value.length : 0 };
};

export const adoptLines = (t: Ctx["t"], offer: AdoptOffer): readonly string[] => {
  if (offer.unregistered.length === 0) return [];
  if (offer.adopted > 0) return [t("install.adopt.done", { count: offer.adopted })];
  return [
    t("install.adopt.offer", { count: offer.unregistered.length }),
    ...offer.unregistered.map((path) => `  ${path}`),
  ];
};

export const withAdopt = <T extends object>(ctx: Ctx, result: CommandResult<T>, adopt: boolean): CommandResult<T> => {
  const offer = adoptOffer(ctx, adopt);
  const lines = adoptLines(ctx.t, offer);
  if (lines.length === 0) return result;
  return { ...result, human: [...(result.human ?? []), ...lines] };
};
