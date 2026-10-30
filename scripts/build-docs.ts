import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SENDS_HOSTS } from "../src/core/footprint.js";
import { BLOCKS, CLAIM_FILES, forbiddenPhrases, missingTests, replaceBetween, threatProblems } from "./docs-gen.js";
import { FAILURE_MODES } from "./failure-modes.js";
import { THREATS } from "./threat-model.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const read = (file: string): string | undefined => {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return undefined;
  }
};

const check = process.argv.includes("--check");
const problems: string[] = [
  ...missingTests(FAILURE_MODES, read),
  ...threatProblems(THREATS, read, (path) => existsSync(join(root, path))),
];

for (const block of BLOCKS) {
  const current = read(block.file) ?? "";
  const next = replaceBetween(current, block.marker, block.render());
  if (next === undefined) problems.push(`${block.file} has no generated:${block.marker} markers`);
  else if (next !== current && check) problems.push(`${block.file} is out of date. Run \`npm run docs\`.`);
  else if (next !== current) writeFileSync(join(root, block.file), next);
}

for (const file of CLAIM_FILES) {
  for (const phrase of forbiddenPhrases(read(file) ?? "", SENDS_HOSTS)) {
    problems.push(`${file} says "${phrase}", but Finite Monkey talks to ${SENDS_HOSTS.join(", ")}`);
  }
}

for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log(check ? "generated docs are up to date" : "generated docs written");
