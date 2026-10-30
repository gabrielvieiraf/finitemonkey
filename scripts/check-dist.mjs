import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundle, bundleMod, MOD_BUNDLE, OUTFILE, PLUGIN_BUNDLE } from "./bundle.mjs";

const dir = mkdtempSync(join(tmpdir(), "fm-dist-"));
try {
  const fresh = readFileSync(await bundle(join(dir, "finitemonkey.mjs")));
  const freshMod = readFileSync(await bundleMod(join(dir, "register.mjs")));
  const read = (path) => {
    try {
      return readFileSync(path);
    } catch {
      return undefined;
    }
  };
  for (const [path, label, built] of [
    [OUTFILE, "dist/finitemonkey.mjs", fresh],
    [PLUGIN_BUNDLE, "plugin/scripts/finitemonkey.mjs", fresh],
    [MOD_BUNDLE, "plugin/hooks/register.mjs", freshMod],
  ]) {
    const committed = read(path);
    if (!committed || !built.equals(committed)) {
      console.error(`${label} is out of date with src/. Run \`npm run build\` and commit it.`);
      process.exit(1);
    }
  }
  console.log("dist/finitemonkey.mjs, plugin/scripts/finitemonkey.mjs and plugin/hooks/register.mjs are up to date");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
