import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadArms } from "./bench-arms.js";
import { pilotChecklist, pilotProblems, readPilotState, realGit } from "./bench-pilot-lib.js";
import { verifyFrozen } from "./bench-prereg.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const benchDir = join(repo, "bench");

const freeze = verifyFrozen(benchDir);
const arms = loadArms(join(benchDir, "arms"));
if (!freeze.ok || !arms.ok) {
  console.error(freeze.ok ? (arms.ok ? "" : arms.error) : freeze.error);
  process.exit(1);
}
const state = readPilotState(benchDir, freeze.value, arms.value, realGit(repo));
for (const line of pilotChecklist(state)) console.log(line);
const problems = pilotProblems(state);
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log("ready for the pilot: record the lines above in DEVIATIONS.md or the run notes");
