import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundle, OUTFILE, PLUGIN_BUNDLE } from "./bundle.mjs";

const dir = mkdtempSync(join(tmpdir(), "fm-dist-"));
try {
  const fresh = readFileSync(await bundle(join(dir, "finitemonkey.mjs")));
  const read = (path) => {
    try {
      return readFileSync(path);
    } catch {
      return undefined;
    }
  };
  for (const [path, label] of [
    [OUTFILE, "dist/finitemonkey.mjs"],
    [PLUGIN_BUNDLE, "plugin/scripts/finitemonkey.mjs"],
  ]) {
    const committed = read(path);
    if (!committed || !fresh.equals(committed)) {
      console.error(`${label} is out of date with src/. Run \`npm run build\` and commit it.`);
      process.exit(1);
    }
  }
  console.log("dist/finitemonkey.mjs and plugin/scripts/finitemonkey.mjs are up to date");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
