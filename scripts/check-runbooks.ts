import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runbookProblems } from "../src/secrets/runbook-check.js";
import { RUNBOOK_PROVIDERS } from "../src/secrets/runbooks.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "runbooks");
const present = readdirSync(dir).filter((name) => name.endsWith(".md"));
const today = new Date().toISOString();

const problems = [
  ...RUNBOOK_PROVIDERS.filter((provider) => !present.includes(`${provider}.md`)).map(
    (provider) => `runbooks/${provider}.md is missing`,
  ),
  ...present.flatMap((name) =>
    runbookProblems(readFileSync(join(dir, name), "utf8"), today).map((problem) => `runbooks/${name}: ${problem}`),
  ),
];

for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log(`${String(present.length)} runbooks checked`);
