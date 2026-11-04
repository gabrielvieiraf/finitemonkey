import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  adHocSignCommands,
  blobCommand,
  type Command,
  nodeProblems,
  postjectCommand,
  SEA_DIR,
  SEA_ENTRY,
  seaAsset,
  seaBinary,
  seaBundleOptions,
  seaEntrySource,
  smokeProblems,
  targetFor,
  unsignCommands,
} from "./sea-lib.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const at = (path: string): string => join(root, ...path.split("/"));

const fail = (problems: readonly string[]): never => {
  for (const problem of problems) console.error(problem);
  process.exit(1);
};

const packageVersion = (): string => {
  const parsed: unknown = JSON.parse(readFileSync(at("package.json"), "utf8"));
  const version: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "version") : undefined;
  return typeof version === "string" ? version : "";
};

const run = ([command, ...args]: Command): void => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) fail([`${command} ${args.join(" ")} exited with ${String(result.status)}`]);
};

const capture = (binary: string, args: readonly string[]) => {
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout: 60_000 });
  return { status: result.status, stdout: result.stdout };
};

const version = packageVersion();
const target = targetFor(process.platform, process.arch) ?? fail([`no release target for ${process.platform}`]);

if (process.argv.includes("--asset-name")) {
  console.log(seaAsset(version, target));
  process.exit(0);
}

const problems = nodeProblems(process.versions.node);
if (problems.length > 0) fail(problems);

const entry = seaEntrySource(readFileSync(at("dist/finitemonkey-core.mjs"), "utf8"), version);
if (entry.problems.length > 0) fail(entry.problems);

mkdirSync(at(SEA_DIR), { recursive: true });
await build(seaBundleOptions(entry.source, at("dist"), at(SEA_ENTRY)));
run(blobCommand(process.execPath));

const binary = at(seaBinary(target));
copyFileSync(process.execPath, binary);
chmodSync(binary, 0o755);
unsignCommands(target).forEach(run);
const postject = createRequire(at("package.json")).resolve("postject/dist/cli.js");
run(postjectCommand(process.execPath, postject, target));
adHocSignCommands(target).forEach(run);
console.log(`built ${seaBinary(target)} for ${seaAsset(version, target)}`);

if (process.argv.includes("--smoke")) {
  const smoke = smokeProblems(version, capture(binary, ["--version"]), capture(binary, ["doctor", "--json"]));
  if (smoke.length > 0) fail(smoke);
  console.log(`${seaBinary(target)} runs --version and doctor --json`);
}
