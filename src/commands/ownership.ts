import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { ownerFromRemote } from "../generate/github/codeowners.js";
import { runGenerator } from "../generate/run.js";
import { detectStack } from "../generate/stack.js";
import { checksResult } from "../githooks/render.js";
import { projectAt } from "../install/project.js";
import { readVocabulary, type Responsibility } from "../ownership/check.js";
import { CATALOG_FILE, OWNERSHIP_FILE } from "../ownership/file.js";
import { OWNERSHIP_FEATURE, ownershipCheck } from "../ownership/gate.js";
import { projectRoot } from "../secrets/project.js";
import type { CommandSpec } from "./types.js";

export const OWNERSHIP_SCHEMA = "finitemonkey/ownership@1";

const SOURCE_PARENTS = ["src", "packages", "apps", "services"] as const;

export const ownershipCheckCommand: CommandSpec = {
  path: ["ownership", "check"],
  summaryKey: "ownership.command.check",
  usage: "finitemonkey ownership check",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) =>
    Promise.resolve(
      checksResult(ctx.t, OWNERSHIP_SCHEMA, "ownership_failed", [ownershipCheck(ctx.runtime, projectRoot(ctx))]),
    ),
};

const defaultOwner = (ctx: Ctx, given: string | undefined): string => {
  if (given !== undefined && given !== "") return given;
  const remote = ctx.runtime.git(["remote", "get-url", "origin"], projectRoot(ctx));
  return (remote.ok ? ownerFromRemote(remote.stdout) : undefined) ?? "";
};

const fromPlan = (vocabulary: readonly Responsibility[], owner: string) =>
  vocabulary.map((item) => ({ name: item.name, type: "component", owner: item.owner || owner, consumers: [] }));

const fromFolders = (ctx: Ctx, owner: string) => {
  const project = projectAt(projectRoot(ctx), ctx.runtime);
  const names = detectStack(ctx.runtime, project.root)
    .dirs(SOURCE_PARENTS)
    .flatMap((parent) => {
      const listed = ctx.runtime.listDir(project.abs(parent));
      return listed.ok ? listed.value.filter((name) => project.isDir(`${parent}/${name}`)) : [];
    });
  return [...new Set(names)].sort().map((name) => ({ name, type: "component", owner, consumers: [] }));
};

export const genOwnershipCommand: CommandSpec = {
  path: ["gen", "ownership"],
  summaryKey: "ownership.command.gen",
  usage: "finitemonkey gen ownership [--owner <@user|@org/team>] [--dry-run] [--yes]",
  status: "ready",
  maxPositionals: 0,
  options: { owner: { type: "string" } },
  run: (ctx, args) => {
    const root = projectRoot(ctx);
    const owner = defaultOwner(ctx, stringOption(args.values, "owner"));
    const catalog = projectAt(root, ctx.runtime).exists(CATALOG_FILE);
    const vocabulary = readVocabulary(ctx.runtime, root);
    const components = vocabulary === undefined ? fromFolders(ctx, owner) : fromPlan(vocabulary, owner);
    const notes = [
      ...(catalog ? [ctx.t("ownership.catalog", { file: CATALOG_FILE })] : []),
      ...(vocabulary === undefined ? [ctx.t("ownership.no_plan")] : []),
      ...(components.some((item) => item.owner === "")
        ? [ctx.t("ownership.fill_owner", { file: OWNERSHIP_FILE })]
        : []),
    ];
    const flag = owner === "" ? "" : ` --owner ${owner}`;
    return Promise.resolve(
      runGenerator(ctx, {
        generator: "ownership",
        feature: OWNERSHIP_FEATURE,
        files: catalog ? [] : [{ path: OWNERSHIP_FILE, text: stringifyYaml({ components }) }],
        notes,
        rerun: `finitemonkey gen ownership${flag} --yes`,
      }),
    );
  },
};
