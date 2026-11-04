import type { Ctx } from "../core/context.js";
import { type CommandResult, success } from "../core/result.js";
import { catalogs, type MessageKey } from "../i18n/catalogs.js";
import { MOD_LABELS_EN, MOD_LABELS_SCHEMA } from "../mod/labels-en.js";
import type { CommandSpec } from "./types.js";

const isMessageKey = (key: string): key is MessageKey => key in catalogs.en;

export const modLabelsOf = (ctx: Pick<Ctx, "lang">): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.keys(MOD_LABELS_EN).flatMap((key) => {
      const own = isMessageKey(key) ? catalogs[ctx.lang][key] : undefined;
      return own === undefined ? [] : [[key, own] as const];
    }),
  );

const showLabels = (ctx: Ctx): CommandResult =>
  success({ schema: MOD_LABELS_SCHEMA, lang: ctx.lang, source: ctx.langSource, labels: modLabelsOf(ctx) }, [
    ctx.t("mod.labels.summary", { lang: ctx.lang, source: ctx.langSource }),
  ]);

export const modLabelsCommand: CommandSpec = {
  path: ["mod", "labels"],
  summaryKey: "command.mod_labels.summary",
  usage: "finitemonkey mod labels [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(showLabels(ctx)),
};
