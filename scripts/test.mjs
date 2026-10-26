import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./bundle.mjs";

const TIMING = new Set(["hook-latency.test.ts", "secrets-rules.test.ts"]);

const dir = join(ROOT, "test");
const names = readdirSync(dir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

const run = (files, extra) =>
  files.length === 0
    ? 0
    : (spawnSync(process.execPath, ["--import", "tsx", "--test", ...extra, ...files, ...process.argv.slice(2)], {
        cwd: ROOT,
        stdio: "inherit",
      }).status ?? 1);

const parallel = run(
  names.filter((name) => !TIMING.has(name)).map((name) => join(dir, name)),
  [],
);
const serial = run(
  names.filter((name) => TIMING.has(name)).map((name) => join(dir, name)),
  ["--test-concurrency=1"],
);
process.exit(parallel === 0 ? serial : parallel);
