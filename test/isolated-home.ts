import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARK = "FM_TEST_HOME";
const WINDOWS_PROFILE_DIRS = [
  ["AppData", "Local"],
  ["AppData", "LocalLow"],
  ["AppData", "Roaming"],
  ["Desktop"],
  ["Documents"],
  ["Downloads"],
] as const;

const seedProfile = (home: string): void => {
  if (process.platform !== "win32") return;
  for (const parts of WINDOWS_PROFILE_DIRS) mkdirSync(join(home, ...parts), { recursive: true });
};

const isolate = (): void => {
  if (process.env[MARK] !== undefined) return;
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-home-")));
  seedProfile(home);
  process.env[MARK] = home;
  process.env["HOME"] = home;
  process.env["USERPROFILE"] = home;
  process.once("exit", () => {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      return;
    }
  });
};

isolate();
