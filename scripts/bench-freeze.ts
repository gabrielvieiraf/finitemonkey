import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { amend, freeze } from "./bench-prereg.js";

const benchDir = join(fileURLToPath(new URL("..", import.meta.url)), "bench");
const { values } = parseArgs({ options: { amend: { type: "string" } }, strict: true });
const today = new Date().toISOString().slice(0, 10);

if (values.amend === undefined) {
  freeze(benchDir, today);
  console.log("bench/PREREGISTRATION.lock.json updated; commit and tag it before the next run");
} else {
  const result = amend(benchDir, today, values.amend);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`bench/PREREGISTRATION.lock.json amended: ${result.value.changed.join(", ")}`);
  console.log("the frozen text hash and date are kept; record the change in DEVIATIONS.md, newest last");
}
