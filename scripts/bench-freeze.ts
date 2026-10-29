import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { freeze } from "./bench-prereg.js";

const benchDir = join(fileURLToPath(new URL("..", import.meta.url)), "bench");
freeze(benchDir, new Date().toISOString().slice(0, 10));
console.log("bench/PREREGISTRATION.lock.json updated; commit and tag it before the next run");
