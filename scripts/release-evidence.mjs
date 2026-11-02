import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SCRIPTS = ["docs", "llms"];
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

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

export const generateNotes = (pluginConfig, context) => {
  if (pluginConfig.notes !== true) return "";
  const script = join(REPO, "scripts", "evidence-notes.ts");
  const args = ["--import", "tsx", script, "--root", context.cwd, "--version", context.nextRelease.version];
  return execFileSync(process.execPath, args, { cwd: REPO, encoding: "utf8" });
};
