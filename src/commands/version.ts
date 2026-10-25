import { success } from "../core/result.js";
import type { CommandSpec } from "./types.js";

export interface VersionData {
  readonly version: string;
  readonly node: string;
  readonly platform: NodeJS.Platform;
}

export const versionCommand: CommandSpec = {
  path: ["version"],
  summaryKey: "command.version.summary",
  usage: "finitemonkey version",
  status: "ready",
  run: (ctx) => {
    const data: VersionData = { version: ctx.version, node: ctx.runtime.nodeVersion, platform: ctx.platform };
    return Promise.resolve(success(data, [ctx.version]));
  },
};
