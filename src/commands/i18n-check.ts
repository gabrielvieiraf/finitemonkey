import { join } from "node:path";

import { stringOption } from "../core/args.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { accept, isRecord, type JsonObject, type Parsed, parseJsonObject, reject } from "../core/parsed.js";
import type { Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { catalogs, reviewStatus } from "../i18n/catalogs.js";
import {
  type CatalogProblem,
  type CatalogReport,
  checkCatalogs,
  type RawCatalogs,
  type RawReview,
} from "../i18n/check.js";
import type { Lang } from "../i18n/languages.js";
import type { CommandSpec } from "./types.js";

export interface I18nCheckData extends CatalogReport {
  readonly source: string;
}

const unreadable = (dir: AbsolutePath, file: string, detail: string): Problem => ({
  code: "i18n_catalog_unreadable",
  messageKey: "error.i18n_catalog_unreadable",
  params: { file, detail },
  fix: `finitemonkey i18n check --dir ${dir}`,
  exitCode: ExitCode.NotConfigured,
});

const readCatalog = (ctx: Ctx, dir: AbsolutePath, lang: Lang): Parsed<JsonObject, Problem> => {
  const file = toAbsolutePath(join(dir, `${lang}.json`));
  const text = ctx.runtime.readText(file);
  if (!text.ok) return reject(unreadable(dir, file, text.error));
  const parsed = parseJsonObject(text.value);
  return parsed.ok ? parsed : reject(unreadable(dir, file, parsed.error));
};

export const loadCatalogs = (ctx: Ctx, dir: AbsolutePath): Parsed<RawCatalogs, Problem> => {
  const en = readCatalog(ctx, dir, "en");
  if (!en.ok) return en;
  const ptBR = readCatalog(ctx, dir, "pt-BR");
  if (!ptBR.ok) return ptBR;
  const es = readCatalog(ctx, dir, "es");
  if (!es.ok) return es;
  return accept({ en: en.value, "pt-BR": ptBR.value, es: es.value });
};

const describeProblem = (ctx: Ctx, problem: CatalogProblem): string => {
  const kind = ctx.t(`i18n.problem.${problem.kind}`, {
    expected: (problem.expected ?? []).join(", "),
    actual: (problem.actual ?? []).join(", "),
  });
  return `  ${problem.lang}  ${problem.key}  ${kind}`;
};

const loadReview = (ctx: Ctx, dir: AbsolutePath): RawReview | undefined => {
  const text = ctx.runtime.readText(toAbsolutePath(join(dir, "review.json")));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return undefined;
  const statuses = (lang: Lang): JsonObject | undefined => {
    const value = parsed.value[lang];
    return isRecord(value) ? value : undefined;
  };
  return { "pt-BR": statuses("pt-BR") ?? {}, es: statuses("es") ?? {} };
};

export const runI18nCheck = (ctx: Ctx, dir: AbsolutePath | undefined): CommandResult<I18nCheckData> => {
  const input = dir === undefined ? accept<RawCatalogs>(catalogs) : loadCatalogs(ctx, dir);
  if (!input.ok) return failureFrom(ctx.t, input.error);
  const report = checkCatalogs(input.value, dir === undefined ? reviewStatus : loadReview(ctx, dir));
  const data: I18nCheckData = { ...report, source: dir ?? "bundled" };
  const summary = ctx.t("i18n.summary", { languages: report.languages.join(", "), keys: report.keys });
  if (report.problems.length === 0) return success(data, [summary, ctx.t("i18n.ok")]);
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human: [summary, ...report.problems.map((problem) => describeProblem(ctx, problem))],
    error: {
      code: "i18n_mismatch",
      message: ctx.t("error.i18n_mismatch", { count: report.problems.length }),
      fix: ctx.t("i18n.fix", { file: dir ?? "src/i18n" }),
    },
  };
};

export const i18nCheckCommand: CommandSpec = {
  path: ["i18n", "check"],
  summaryKey: "command.i18n_check.summary",
  usage: "finitemonkey i18n check [--dir <path>]",
  status: "ready",
  options: { dir: { type: "string" } },
  run: (ctx, args) => {
    const dir = stringOption(args.values, "dir");
    return Promise.resolve(runI18nCheck(ctx, dir === undefined ? undefined : toAbsolutePath(dir, ctx.cwd)));
  },
};
