import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import {
  bumpStats,
  type Lesson,
  LESSON_SOURCES,
  newLesson,
  pruneLessons,
  readStats,
  writeLessons,
} from "../learnings/store.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import { FM_DIR } from "../task/paths.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const LEARNINGS_SCHEMA = "finitemonkey/learnings@1";

const dirOf = (ctx: Ctx): AbsolutePath => toAbsolutePath(join(projectRoot(ctx), FM_DIR));

const option = (values: OptionValues, key: string): string | undefined => {
  const value = values[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

const lessonLine = (ctx: Pick<Ctx, "t">, lesson: Lesson): string =>
  (lesson.quarantined === true
    ? `${ctx.t("learnings.quarantined", { id: lesson.id, origin: lesson.origin ?? "" })} `
    : "") +
  ctx.t("learnings.row", {
    id: lesson.id,
    source: lesson.source,
    key: [lesson.sig === undefined ? "" : `sig ${lesson.sig}`, lesson.paths.join(", ")]
      .filter((part) => part !== "")
      .join("; "),
    uses: lesson.uses,
    text: lesson.text,
  });

const listed = (ctx: Ctx): CommandResult => {
  const dir = dirOf(ctx);
  const { kept, expired } = pruneLessons(ctx.runtime, dir);
  const stats = readStats(ctx.runtime, dir);
  const measure = { lessons: kept.length, used: kept.filter((lesson) => lesson.uses > 0).length, ...stats };
  const data = { schema: LEARNINGS_SCHEMA, lessons: kept, expiredNow: expired.length, measure };
  const human = [
    ctx.t("learnings.title", { count: kept.length }),
    ...kept.map((lesson) => lessonLine(ctx, lesson)),
    ctx.t("learnings.measure", { ...measure }),
  ];
  return success(data, human);
};

const missing = (ctx: Ctx, id: string): CommandResult =>
  failureFrom(ctx.t, usageProblem("invalid_arguments", "learnings.error.unknown", "finitemonkey learnings", { id }));

const change = (ctx: Ctx, id: string, update: (lesson: Lesson) => Lesson | undefined): CommandResult => {
  const dir = dirOf(ctx);
  const { kept } = pruneLessons(ctx.runtime, dir);
  if (!kept.some((lesson) => lesson.id === id)) return missing(ctx, id);
  const next = kept.flatMap((lesson) => {
    if (lesson.id !== id) return [lesson];
    const updated = update(lesson);
    return updated === undefined ? [] : [updated];
  });
  writeLessons(ctx.runtime, dir, next);
  if (next.length < kept.length) bumpStats(ctx.runtime, dir, { deleted: 1 });
  const after = pruneLessons(ctx.runtime, dir).kept;
  return success({ schema: LEARNINGS_SCHEMA, id, lessons: after }, [ctx.t("learnings.changed", { id })]);
};

export const learningsCommand: CommandSpec = {
  path: ["learnings"],
  summaryKey: "learnings.command.list",
  usage: "finitemonkey learnings",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(listed(ctx)),
};

export const learningsAddCommand: CommandSpec = {
  path: ["learnings", "add"],
  summaryKey: "learnings.command.add",
  usage:
    "finitemonkey learnings add --text <lesson> [--paths <glob,glob>] [--sig <signature>] [--source correction|advisor|person]",
  status: "ready",
  maxPositionals: 0,
  options: { text: { type: "string" }, paths: { type: "string" }, sig: { type: "string" }, source: { type: "string" } },
  run: (ctx, args) => {
    const body = option(args.values, "text");
    const paths = (option(args.values, "paths") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    const sig = option(args.values, "sig");
    const source = LESSON_SOURCES.find((item) => item === (option(args.values, "source") ?? "person"));
    if (body === undefined || source === undefined || (paths.length === 0 && sig === undefined))
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem(
            "invalid_arguments",
            "learnings.error.add",
            'finitemonkey learnings add --text "..." --paths "src/**"',
          ),
        ),
      );
    const dir = dirOf(ctx);
    const { kept } = pruneLessons(ctx.runtime, dir);
    const lesson = newLesson({ text: body, paths, sig, source }, ctx.runtime.now());
    ctx.runtime.mkdir(dir);
    writeLessons(ctx.runtime, dir, [...kept.filter((item) => item.id !== lesson.id), lesson]);
    return Promise.resolve(
      success({ schema: LEARNINGS_SCHEMA, id: lesson.id, lessons: [lesson] }, [
        ctx.t("learnings.added", { id: lesson.id }),
      ]),
    );
  },
};

export const learningsEditCommand: CommandSpec = {
  path: ["learnings", "edit"],
  summaryKey: "learnings.command.edit",
  usage: "finitemonkey learnings edit <id> [--text <lesson>] [--paths <glob,glob>]",
  status: "ready",
  maxPositionals: 1,
  options: { text: { type: "string" }, paths: { type: "string" } },
  run: (ctx, args) => {
    const body = option(args.values, "text");
    const paths = option(args.values, "paths")
      ?.split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return Promise.resolve(
      change(ctx, args.positionals[0] ?? "", (lesson) => ({
        ...lesson,
        text: body ?? lesson.text,
        paths: paths ?? lesson.paths,
      })),
    );
  },
};

export const learningsDeleteCommand: CommandSpec = {
  path: ["learnings", "delete"],
  summaryKey: "learnings.command.delete",
  usage: "finitemonkey learnings delete <id>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(change(ctx, args.positionals[0] ?? "", () => undefined)),
};

export const learningsUnhelpfulCommand: CommandSpec = {
  path: ["learnings", "unhelpful"],
  summaryKey: "learnings.command.unhelpful",
  usage: "finitemonkey learnings unhelpful <id>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    Promise.resolve(
      change(ctx, args.positionals[0] ?? "", (lesson) => ({ ...lesson, unhelpful: lesson.unhelpful + 1 })),
    ),
};

export const learningsAcceptCommand: CommandSpec = {
  path: ["learnings", "accept"],
  summaryKey: "learnings.command.accept",
  usage: "finitemonkey learnings accept <id>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    if (!isPerson(ctx)) {
      return Promise.resolve(
        failureFrom(ctx.t, needsPersonProblem("learnings.error.person_only", "finitemonkey learnings accept <id>")),
      );
    }
    return Promise.resolve(
      change(ctx, args.positionals[0] ?? "", (lesson) => ({
        ...lesson,
        quarantined: false,
        origin: `${lesson.origin ?? lesson.source}, accepted by the person`,
      })),
    );
  },
};
