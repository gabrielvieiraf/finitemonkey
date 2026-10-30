import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT } from "./bundle.mjs";

const TIMING = new Set(["hook-latency.test.ts", "secrets-rules.test.ts"]);

const dir = join(ROOT, "test");
const names = readdirSync(dir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

const IDENTITY = /^GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)$/;
const realKey = join(homedir(), ".finitemonkey", "ledger.key");
const keyStamp = () => {
  try {
    const stat = statSync(realKey);
    return `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
  } catch {
    return "absent";
  }
};
const keyBefore = keyStamp();
const home = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-test-home-")));
if (process.platform === "win32") {
  for (const parts of [
    ["AppData", "Local"],
    ["AppData", "LocalLow"],
    ["AppData", "Roaming"],
    ["Desktop"],
    ["Documents"],
    ["Downloads"],
  ]) {
    mkdirSync(join(home, ...parts), { recursive: true });
  }
}
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !IDENTITY.test(name))),
  HOME: home,
  USERPROFILE: home,
};

const run = (files, extra) =>
  files.length === 0
    ? 0
    : (spawnSync(process.execPath, ["--import", "tsx", "--test", ...extra, ...files, ...process.argv.slice(2)], {
        cwd: ROOT,
        env,
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
try {
  rmSync(home, { recursive: true, force: true });
} catch {
  console.error(`could not remove the test home ${home}`);
}
const keyAfter = keyStamp();
if (keyAfter !== keyBefore) {
  console.error(`tests touched the real ledger key at ${realKey} (${keyBefore} -> ${keyAfter})`);
  process.exit(1);
}
process.exit(parallel === 0 ? serial : parallel);
