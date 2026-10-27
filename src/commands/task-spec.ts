import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { slugOf } from "../plan/folder.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { criteriaOf } from "../spec/criteria.js";
import { formatOf, parseSpec } from "../spec/parse.js";
import { contractHash } from "../task/load.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { contractYaml } from "../task/serialize.js";
import { readState, readTrust, writeState, writeTrust } from "../task/state.js";
import { TASK_ID, TASK_SCHEMA, type TaskContract } from "../task/types.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey task from-spec <tasks.md> [--id <task id>] [--goal <text>] [--port <n>]";

const idFrom = (file: string): string => {
  const change = /openspec[\\/]changes[\\/]([^\\/]+)[\\/]/.exec(file)?.[1];
  return slugOf(change ?? file.replace(/^.*[\\/]/, "").replace(/\.md$/, "")).slice(0, 64);
};

const save = (ctx: Ctx, paths: FmPaths, contract: TaskContract, text: string): boolean => {
  if (ctx.runtime.stat(paths.task(contract.id)) !== undefined) return false;
  if (!ctx.runtime.writeText(paths.task(contract.id), text).ok) return false;
  const lock = readTrust(ctx.runtime, paths);
  writeTrust(ctx.runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [contract.id]: contractHash(contract) },
    approved: { ...lock.approved, [contract.id]: text },
  });
  writeState(ctx.runtime, paths, { ...readState(ctx.runtime, paths), active: contract.id });
  return true;
};

const portOf = (raw: string | undefined): number | undefined => {
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
};

export const taskFromSpecCommand: CommandSpec = {
  path: ["task", "from-spec"],
  summaryKey: "command.task_from_spec.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { id: { type: "string" }, goal: { type: "string" }, port: { type: "string" } },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const file = args.positionals[0];
    const source = file === undefined ? undefined : ctx.runtime.readText(toAbsolutePath(file, ctx.cwd));
    if (file === undefined || source?.ok !== true)
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "spec.error.read", USAGE, { file: file ?? "-" })),
      );
    const criteria = criteriaOf(parseSpec(source.value), portOf(stringOption(args.values, "port")));
    const id = stringOption(args.values, "id") ?? idFrom(file);
    if (criteria.length === 0 || !TASK_ID.test(id))
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "spec.error.empty", USAGE, { file })),
      );
    const contract: TaskContract = {
      id,
      goal: stringOption(args.values, "goal") ?? id,
      size: "M",
      scope: { paths: [], testsProtected: true },
      acceptance: criteria.map((item) => item.check),
      decisionsNeeded: [],
      implicit: false,
    };
    const text = stringifyYaml(contractYaml(contract));
    const written = stringOption(args.values, "id") !== undefined && save(ctx, fmPaths(repo.root), contract, text);
    const data = {
      schema: TASK_SCHEMA,
      source: file,
      format: formatOf(file, source.value),
      sourceSha256: sha256Hex(source.value),
      written,
      criteria: criteria.map(({ check, ...item }) => ({ ...item, kind: check.kind })),
      contract: text,
    };
    const unchecked = criteria.filter((item) => !item.checkable).length;
    return Promise.resolve(
      success(data, [
        ctx.t("spec.proposed", { count: criteria.length, unchecked, format: data.format }),
        ...criteria
          .filter((item) => !item.checkable)
          .map((item) => `  ${ctx.t("spec.unchecked", { id: item.id, from: item.from, text: item.text })}`),
        text.trimEnd(),
        ...(written ? [ctx.t("task.created", { task: id, file: fmPaths(repo.root).task(id) })] : []),
      ]),
    );
  },
};
