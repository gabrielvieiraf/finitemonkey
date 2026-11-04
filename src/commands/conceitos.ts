import { bookConcepts, bookPath, raise, readBook, writeBook } from "../conceitos/book.js";
import { recordLevels } from "../conceitos/book-log.js";
import { CONCEPT_LEVELS, parseConcept, parseConceptLevel } from "../conceitos/concepts.js";
import { creditGate } from "../conceitos/credit.js";
import { CONCEPT_EVIDENCE_SCHEMA, conceptSummaries, type ConceptSummary } from "../conceitos/evidence.js";
import { updateFromPending } from "../conceitos/hooks.js";
import { conceptLabel } from "../conceitos/label.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { whenEnabled } from "../provider/adapters.js";
import { providerCodeConcepts } from "../provider/adapters-more.js";
import { providerDeps } from "../provider/wire.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const CONCEITOS_SCHEMA = "finitemonkey/conceitos@1";

export const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

const bookJson = (ctx: Ctx): Readonly<Record<string, unknown>> => {
  const book = readBook(ctx.runtime, pathsOf(ctx));
  return {
    schema: CONCEITOS_SCHEMA,
    concepts: Object.fromEntries(
      bookConcepts(book).flatMap((id) => {
        const entry = book.concepts[id];
        return entry === undefined ? [] : [[id, { level: entry.level, updatedAt: entry.updatedAt }]];
      }),
    ),
  };
};

export const show = (ctx: Ctx): CommandResult => {
  const book = readBook(ctx.runtime, pathsOf(ctx));
  const known = bookConcepts(book);
  const lines =
    known.length === 0
      ? [ctx.t("conceitos.show.empty")]
      : known.map((id) =>
          ctx.t("conceitos.show.line", {
            concept: conceptLabel(ctx.t, id),
            level: ctx.t(`conceitos.level.${book.concepts[id]?.level ?? "seen"}`),
          }),
        );
  return success(bookJson(ctx), lines);
};

const exportBook = (ctx: Ctx): CommandResult => {
  const text = ctx.runtime.readText(bookPath(pathsOf(ctx)));
  return success(bookJson(ctx), [text.ok ? text.value.trimEnd() : ctx.t("conceitos.show.empty")]);
};

const update = (ctx: Ctx): CommandResult => {
  const paths = pathsOf(ctx);
  const ids = updateFromPending(ctx.runtime, paths);
  const proposer = whenEnabled(providerDeps(ctx, paths), "code-concepts", providerCodeConcepts);
  const credited = creditGate(ctx.runtime, paths, proposer);
  return success({ schema: CONCEITOS_SCHEMA, seen: [...ids], credited: credited.length }, []);
};

const evidenceJson = (summaries: readonly ConceptSummary[]): Readonly<Record<string, unknown>> => ({
  schema: CONCEPT_EVIDENCE_SCHEMA,
  concepts: summaries.map((item) => ({
    concept: item.concept,
    domain: item.domain,
    state: item.state,
    positive: item.positive,
    negative: item.negative,
    exposures: item.exposures,
    last: item.last,
    evidence: item.evidence.map((event) => ({
      at: event.at,
      kind: event.kind,
      task: event.task ?? null,
      file: event.file ?? null,
      source: event.source ?? null,
      origin: event.origin,
    })),
  })),
});

const evidence = (ctx: Ctx): CommandResult => {
  const summaries = conceptSummaries(ctx.runtime, pathsOf(ctx));
  return success(
    evidenceJson(summaries),
    summaries.map((item) =>
      ctx.t("conceitos.evidence.line", {
        concept: conceptLabel(ctx.t, item.concept),
        state: ctx.t(`conceitos.state.${item.state}`),
        positive: item.positive,
        negative: item.negative,
        exposures: item.exposures,
      }),
    ),
  );
};

const MARK_USAGE = `fm conceitos mark <concept> <${CONCEPT_LEVELS.join("|")}>`;

const mark = (ctx: Ctx, rawConcept: string | undefined, rawLevel: string | undefined): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("perfil.error.person_only", MARK_USAGE));
  const concept = parseConcept(rawConcept, readBook(ctx.runtime, pathsOf(ctx)).aliases);
  const level = parseConceptLevel(rawLevel);
  if (concept === undefined || level === undefined) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", MARK_USAGE, {
        detail: `${rawConcept ?? ""} ${rawLevel ?? ""}`,
      }),
    );
  }
  const paths = pathsOf(ctx);
  const before = readBook(ctx.runtime, paths);
  const after = raise(before, concept, level, ctx.runtime.now());
  writeBook(ctx.runtime, paths, after);
  recordLevels(ctx.runtime, paths, { before, after }, "person");
  return show(ctx);
};

export const conceitosCommand: CommandSpec = {
  path: ["conceitos"],
  summaryKey: "command.conceitos.summary",
  usage: "finitemonkey conceitos",
  status: "ready",
  run: (ctx) => Promise.resolve(show(ctx)),
};

export const conceitosExportCommand: CommandSpec = {
  path: ["conceitos", "export"],
  summaryKey: "command.conceitos_export.summary",
  usage: "finitemonkey conceitos export",
  status: "ready",
  run: (ctx) => Promise.resolve(exportBook(ctx)),
};

export const conceitosUpdateCommand: CommandSpec = {
  path: ["conceitos", "update"],
  summaryKey: "command.conceitos_update.summary",
  usage: "finitemonkey conceitos update",
  status: "ready",
  run: (ctx) => Promise.resolve(update(ctx)),
};

export const conceitosMarkCommand: CommandSpec = {
  path: ["conceitos", "mark"],
  summaryKey: "command.conceitos_mark.summary",
  usage: MARK_USAGE,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => Promise.resolve(mark(ctx, args.positionals[0], args.positionals[1])),
};

export const conceitosEvidenceCommand: CommandSpec = {
  path: ["conceitos", "evidence"],
  summaryKey: "command.conceitos_evidence.summary",
  usage: "finitemonkey conceitos evidence",
  status: "ready",
  run: (ctx) => Promise.resolve(evidence(ctx)),
};
