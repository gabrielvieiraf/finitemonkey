import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./bundle.mjs";

const dir = join(ROOT, "test");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => join(dir, name));
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files, ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
