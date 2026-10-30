import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import type { JsonObject } from "../core/parsed.js";
import { curlFetcher, urlOf } from "../judge/fetch.js";
import { markUntrusted } from "../policy/untrusted.js";
import { fmPaths } from "../task/paths.js";
import { judgeCommand } from "./judge.js";

const ORIGINS = new Set(["web", "pdf", "tool", "file"]);

const contentOf = (ctx: Ctx, root: string, source: string): string | undefined => {
  const fetched = curlFetcher(ctx.runtime, root)(source);
  return fetched.status === "ok" ? fetched.content : undefined;
};

const readRecord = (
  ctx: Ctx,
  values: Readonly<Record<string, unknown>>,
  source: string | undefined,
  root: string,
): JsonObject | undefined => {
  const origin =
    typeof values["origin"] === "string"
      ? values["origin"]
      : source !== undefined && urlOf(source) !== undefined
        ? "web"
        : "file";
  if (source === undefined || !ORIGINS.has(origin)) return undefined;
  const content = contentOf(ctx, root, source);
  if (content === undefined) return undefined;
  markUntrusted(ctx.runtime, fmPaths(toAbsolutePath(root)), ctx.env["CLAUDE_SESSION_ID"] ?? "", "judge read");
  return { verb: "read", origin, source, content };
};

export const judgeReadCommand = judgeCommand({
  path: ["judge", "read"],
  summaryKey: "command.judge_read.summary",
  usage: "finitemonkey judge read <file|url> [--origin web|pdf|tool|file]",
  options: { origin: { type: "string" } },
  maxPositionals: 1,
  build: (ctx, values, positionals, root) => readRecord(ctx, values, positionals[0], root),
});

export const judgePromoteCommand = judgeCommand({
  path: ["judge", "promote"],
  summaryKey: "command.judge_promote.summary",
  usage: "finitemonkey judge promote <claim>",
  maxPositionals: 1,
  build: (_ctx, values, positionals) => ({ verb: "promote", claim: positionals[0] ?? stringOption(values, "claim") }),
});
