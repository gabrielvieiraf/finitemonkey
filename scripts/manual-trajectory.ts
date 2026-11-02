import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { FM_DIR } from "../src/task/paths.js";
import { manualTrajectoryFiles } from "./manual-trajectory-lib.js";

const USAGE = "usage: npm run manual:trajectory -- --dir <empty or new folder>";

const dirArg = (args: readonly string[]): string | undefined => {
  const at = args.indexOf("--dir");
  return at === -1 ? undefined : args[at + 1];
};

const target = dirArg(process.argv.slice(2));
if (target === undefined || target === "") {
  console.error(USAGE);
  process.exit(2);
}

const root = resolve(target);
if (existsSync(join(root, FM_DIR))) {
  console.error(`${join(root, FM_DIR)} already exists; pick a new folder so no real record is overwritten`);
  process.exit(2);
}

for (const [path, text] of Object.entries(manualTrajectoryFiles(Date.now()))) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, { flag: "wx" });
  console.log(`wrote ${file}`);
}
console.log(`open Claude Code in ${root} and run /fm trajectory`);
