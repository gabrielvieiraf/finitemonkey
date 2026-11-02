import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSbom } from "./sbom-lib.js";
import { parseLockfile } from "./sbom-lock.js";
import { validateSbom } from "./sbom-validate.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const timestamp = (): string => {
  const epoch = process.env["SOURCE_DATE_EPOCH"];
  const date = epoch !== undefined && /^\d+$/.test(epoch) ? new Date(Number(epoch) * 1000) : new Date();
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const lockPath = resolve(option("lock") ?? join(root, "package-lock.json"));
const lock = parseLockfile(readFileSync(lockPath, "utf8"));
const toolVersion = lock.packages.get("")?.version ?? "0.0.0";
const result = buildSbom(lock, option("timestamp") ?? timestamp(), toolVersion);
const problems = result.bom === undefined ? result.problems : validateSbom(result.bom);

for (const problem of problems) console.error(problem);
if (result.bom === undefined || problems.length > 0) process.exit(1);

const text = `${JSON.stringify(result.bom, null, 2)}\n`;
const out = option("out");
if (out === undefined) process.stdout.write(text);
else writeFileSync(resolve(out), text);
