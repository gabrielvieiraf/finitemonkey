import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_SCRIPTS = ["docs", "llms"];

export const prepare = (pluginConfig, context) => {
  const file = join(context.cwd, "bench", "evidence.json");
  const evidence = JSON.parse(readFileSync(file, "utf8"));
  const version = context.nextRelease.version;
  writeFileSync(file, `${JSON.stringify({ ...evidence, version }, null, 2)}\n`);
  for (const script of pluginConfig.scripts ?? DEFAULT_SCRIPTS) {
    execFileSync("npm", ["run", script], { cwd: context.cwd, stdio: "inherit" });
  }
  context.logger.log(`evidence labeled with ${version}, README tables and llms-full rebuilt`);
};
