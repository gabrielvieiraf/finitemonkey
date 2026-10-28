import { listOption, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { type InventoryProblem, runInventory } from "../inventory/run.js";
import { INVENTORY_SCHEMA } from "../inventory/types.js";
import { initParity, updateParity } from "../parity/run.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

type Root = NonNullable<ReturnType<typeof repoOf>>["root"];

const USAGE = "finitemonkey inventory <topic> [--ref <ref>] [--path <dir>]... [--repo <dir>]... [--parity]";

const problemResult = (ctx: Ctx, problem: InventoryProblem): CommandResult => {
  if (problem.kind === "repo") return failureFrom(ctx.t, notRepository(problem.repo));
  if (problem.kind === "ref")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "inventory.error.ref", USAGE, { ref: problem.ref, repo: problem.repo }),
    );
  return failureFrom(ctx.t, {
    code: "plan_write_failed",
    messageKey: "plan.error.write",
    params: { detail: problem.detail },
    fix: "check that docs/plan can be written",
    exitCode: ExitCode.CheckFailed,
  });
};

const parityFor = (ctx: Ctx, root: Root, ref: string, covered: readonly string[]): readonly string[] => {
  const started = initParity(ctx.runtime, root, ref, covered);
  const written = !started.ok && started.error === "exists" ? updateParity(ctx.runtime, root, ref) : started;
  return written.ok ? [ctx.t("parity.written", { rows: written.value.rows, added: written.value.added })] : [];
};

export const inventoryCommand: CommandSpec = {
  path: ["inventory"],
  summaryKey: "command.inventory.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: {
    ref: { type: "string" },
    path: { type: "string", multiple: true },
    repo: { type: "string", multiple: true },
    parity: { type: "boolean" },
  },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const topic = args.positionals[0]?.trim() ?? "";
    if (topic === "")
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "inventory.error.topic", USAGE)));
    const written = runInventory(ctx.runtime, ctx.t, repo.root, {
      topic,
      ref: stringOption(args.values, "ref") ?? "HEAD",
      covered: listOption(args.values, "path"),
      repos: listOption(args.values, "repo"),
    });
    if (!written.ok) return Promise.resolve(problemResult(ctx, written.error));
    const { file, inventory } = written.value;
    const repos = inventory.repos.map((item) => ({ path: item.path, ref: item.ref, hash: item.hash }));
    const parity =
      args.values["parity"] === true
        ? parityFor(ctx, repo.root, inventory.repos[0]?.ref ?? "HEAD", inventory.covered)
        : [];
    return Promise.resolve(
      success({ schema: INVENTORY_SCHEMA, file, topic, covered: inventory.covered, repos, delta: inventory.delta }, [
        ctx.t("inventory.written", { file, count: repos.length }),
        ...repos.map((item) => `  ${item.path} ${item.hash}`),
        ...parity,
      ]),
    );
  },
};
