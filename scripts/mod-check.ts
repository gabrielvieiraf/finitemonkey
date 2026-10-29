import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { footprintDiff, footprintOf, footprintText, parseFootprint } from "./mod-footprint.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "plugin");
const FOOTPRINT = join(PLUGIN, "FOOTPRINT.json");
const MOD_TESTS = join(ROOT, "test", "mod");
const isWindows = process.platform === "win32";
const inCi = process.env["CI"] === "true";

const claude = (args: readonly string[], env?: NodeJS.ProcessEnv, cwd = ROOT): SpawnSyncReturns<string> =>
  spawnSync(isWindows ? "claude.cmd" : "claude", args, {
    cwd,
    encoding: "utf8",
    shell: isWindows,
    timeout: 120_000,
    ...(env === undefined ? {} : { env }),
  });

const fail = (message: string): never => {
  console.error(`mod: ${message}`);
  process.exit(1);
};

const freshFootprint = (): ReturnType<typeof footprintOf> => {
  const result = claude(["plugin", "validate", "--json", "plugin"]);
  try {
    return footprintOf(JSON.parse(result.stdout));
  } catch {
    return fail(`claude plugin validate --json printed no report:\n${result.stdout}${result.stderr}`);
  }
};

const checkFootprint = (write: boolean): void => {
  const fresh = freshFootprint() ?? fail("claude plugin validate --json reported no hooks module");
  if (write) {
    writeFileSync(FOOTPRINT, footprintText(fresh));
    console.log(`mod: wrote plugin/FOOTPRINT.json (${String(fresh.reach.length)} reach lines)`);
    return;
  }
  const committed = existsSync(FOOTPRINT) ? parseFootprint(readFileSync(FOOTPRINT, "utf8")) : undefined;
  if (committed === undefined) fail("plugin/FOOTPRINT.json is missing; run npm run plugin:footprint and commit it");
  const diff = footprintDiff(committed ?? fresh, fresh);
  if (diff.length > 0)
    fail(
      `the mod's footprint changed and plugin/FOOTPRINT.json was not updated:\n${diff.join("\n")}\nReview the new reach, then run npm run plugin:footprint and commit it.`,
    );
  console.log("mod: footprint matches plugin/FOOTPRINT.json");
};

const sandboxEnv = (home: string): NodeJS.ProcessEnv => ({
  PATH: process.env["PATH"] ?? "",
  HOME: home,
  USERPROFILE: home,
  TERM: "dumb",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  ...(isWindows ? { SystemRoot: process.env["SystemRoot"] ?? "", APPDATA: join(home, "AppData") } : {}),
});

const smoke = (): void => {
  const dir = mkdtempSync(join(tmpdir(), "fm-mod-smoke-"));
  try {
    const home = join(dir, "home");
    const work = join(dir, "work");
    mkdirSync(home);
    mkdirSync(work);
    const log = join(dir, "debug.log");
    claude(["-p", "hi", "--plugin-dir", PLUGIN, "--debug-file", log], sandboxEnv(home), work);
    const text = existsSync(log) ? readFileSync(log, "utf8") : "";
    if (text.includes("hooks modules are turned off")) {
      if (inCi) fail("hooks modules are turned off in this process; the mod could not load");
      console.warn("mod: hooks modules are turned off on this machine; load check skipped");
      return;
    }
    if (!text.includes("hooks module finitemonkey@inline loaded")) fail("the mod did not load with --plugin-dir");
    if (!/plugin\.register: finitemonkey \(user, finitemonkey@inline\).*admitted/.test(text))
      fail("the mod loaded but was not admitted");
    if (!/Registered \d+ hooks/.test(text)) fail("the command hooks did not register next to the mod");
    console.log("mod: loads with --plugin-dir next to the command hooks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const runTests = (): void => {
  const dir = mkdtempSync(join(tmpdir(), "fm-mod-test-"));
  try {
    cpSync(PLUGIN, dir, { recursive: true });
    const tests = join(dir, "tests");
    mkdirSync(tests);
    for (const name of readdirSync(MOD_TESTS).filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts")))
      cpSync(join(MOD_TESTS, name), join(tests, name));
    const home = join(dir, ".home");
    mkdirSync(home);
    const result = claude(["plugin", "test", dir], sandboxEnv(home));
    const output = `${result.stdout}${result.stderr}`;
    if (output.includes("hooks modules are turned off")) {
      if (inCi) fail(`claude plugin test could not run:\n${output}`);
      console.warn("mod: hooks modules are turned off on this machine; mod tests skipped");
      return;
    }
    process.stdout.write(output);
    if (result.status !== 0) fail("claude plugin test failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const write = process.argv.includes("--write");
if (claude(["--version"]).status !== 0) {
  if (write) fail("claude is needed to write plugin/FOOTPRINT.json");
  console.log("mod: claude not found; footprint, load and mod tests checked in CI");
} else {
  checkFootprint(write);
  if (!write) {
    smoke();
    runTests();
  }
}
