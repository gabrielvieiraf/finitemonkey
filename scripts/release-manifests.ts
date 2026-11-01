import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKSUMS_FILE } from "./release-assets.js";
import { releaseManifests } from "./release-files.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const packageVersion = (): string => {
  const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "version") : undefined;
  return typeof version === "string" ? version : "";
};

const checksumsPath = option("checksums");
const outPath = option("out");
if (checksumsPath === undefined || outPath === undefined) {
  console.error(`usage: npm run release:manifests -- --checksums <${CHECKSUMS_FILE}> --out <dir> [--version <x.y.z>]`);
  process.exit(2);
}

const version = option("version") ?? packageVersion();
const out = resolve(outPath);
const result = releaseManifests(version, readFileSync(resolve(checksumsPath), "utf8"));

for (const problem of result.problems) console.error(problem);
if (result.problems.length > 0) process.exit(1);

for (const file of result.files) {
  const target = join(out, ...file.path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
  console.log(target);
}
