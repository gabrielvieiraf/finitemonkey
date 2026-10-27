import { toAbsolutePath } from "../core/brand.js";
import { failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { projectRoot } from "../secrets/project.js";
import { updateConfig, type UpdateEcosystem } from "../supply/update-config.js";
import type { CommandSpec } from "./types.js";

export const DEPS_CONFIG_SCHEMA = "finitemonkey/deps-config@1";

export interface DepsConfigData {
  readonly schema: typeof DEPS_CONFIG_SCHEMA;
  readonly tool: "dependabot" | "renovate";
  readonly file: string;
  readonly ecosystems: readonly UpdateEcosystem[];
  readonly text: string;
  readonly written: boolean;
}

export const depsConfigCommand: CommandSpec = {
  path: ["deps", "config"],
  summaryKey: "deps.command.config",
  usage: "finitemonkey deps config [--renovate] [--write]",
  status: "ready",
  maxPositionals: 0,
  options: { renovate: { type: "boolean" }, write: { type: "boolean" } },
  run: (ctx, args) => {
    const root = projectRoot(ctx);
    const tool = args.values["renovate"] === true ? "renovate" : "dependabot";
    const config = updateConfig(ctx.runtime, root, tool);
    const write = args.values["write"] === true;
    const data: DepsConfigData = { schema: DEPS_CONFIG_SCHEMA, tool, ...config, written: write };
    if (!write)
      return Promise.resolve(success(data, [config.text, ctx.t("deps.config.preview", { file: config.file })]));
    const target = toAbsolutePath(config.file, root);
    const dir = toAbsolutePath(
      config.file.includes("/") ? config.file.slice(0, config.file.lastIndexOf("/")) : ".",
      root,
    );
    const made = ctx.runtime.mkdir(dir);
    const saved = made.ok ? ctx.runtime.writeText(target, config.text) : made;
    if (saved.ok) return Promise.resolve(success(data, [ctx.t("deps.config.written", { file: config.file })]));
    return Promise.resolve(
      failureFrom(ctx.t, {
        code: "deps_write_failed",
        messageKey: "deps.config.write_failed",
        params: { file: config.file, detail: saved.error },
        fix: `check that ${config.file} can be written, then run the command again`,
        exitCode: ExitCode.CheckFailed,
        data: { ...data, written: false },
      }),
    );
  },
};
