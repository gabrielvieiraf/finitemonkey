import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { benchResult, type Observed } from "../test/guardian-bench-score.js";
import { observe, readScenario, scenarioFiles } from "../test/guardian-bench-support.js";
import { ROOT } from "../test/support.js";

const observed: Observed[] = [];
for (const scenario of scenarioFiles().map(readScenario)) observed.push({ scenario, ...(await observe(scenario)) });
const result = benchResult(observed);
writeFileSync(join(ROOT, "bench", "guardian", "results.json"), `${JSON.stringify(result, null, 2)}\n`);
for (const item of result.scenarios)
  console.log(`${item.id}: expected ${String(item.expected)}, observed ${String(item.observed)}`);
console.log(JSON.stringify(result.personas, null, 2));
