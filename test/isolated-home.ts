import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARK = "FM_TEST_HOME";

const isolate = (): void => {
  if (process.env[MARK] !== undefined) return;
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-home-")));
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
