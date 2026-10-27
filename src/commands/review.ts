import { stringOption } from "../core/args.js";
import { failureFrom, success } from "../core/result.js";
import { repoFacts } from "../git/repo.js";
import { buildPacket } from "../review/packet.js";
import { gitProblem, notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const REVIEW_PACKET_SCHEMA = "finitemonkey/review-packet@1";

export const reviewPacketCommand: CommandSpec = {
  path: ["review", "packet"],
  summaryKey: "review.command.packet",
  usage: "finitemonkey review packet [--base <ref>] [--json]",
  status: "ready",
  options: { base: { type: "string" } },
  run: (ctx, args) => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const base = stringOption(args.values, "base") ?? repoFacts(ctx.runtime, repo).defaultBranch();
    const resolved = ctx.runtime.git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], repo.root);
    const head = ctx.runtime.git(["rev-parse", "HEAD"], repo.root).stdout.trim();
    if (!resolved.ok || head === "")
      return Promise.resolve(
        failureFrom(
          ctx.t,
          gitProblem("invalid_arguments", "review.error.no_base", base, "finitemonkey review packet --base <ref>"),
        ),
      );
    const packet = buildPacket(ctx.runtime, repo.root, base, head);
    return Promise.resolve(success({ schema: REVIEW_PACKET_SCHEMA, ...packet }, [packet.text]));
  },
};
