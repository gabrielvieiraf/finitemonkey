import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundle, BUNDLE_FILES, bundleMod, DIST, MOD_BUNDLE, PLUGIN_SCRIPTS } from "./bundle.mjs";

const dir = mkdtempSync(join(tmpdir(), "fm-dist-"));
try {
  await bundle(dir);
  const freshMod = readFileSync(await bundleMod(join(dir, "register.mjs")));
  const read = (path) => {
    try {
      return readFileSync(path);
    } catch {
      return undefined;
    }
  };
  const targets = [
    ...BUNDLE_FILES.flatMap((name) => [
      [join(DIST, name), `dist/${name}`, readFileSync(join(dir, name))],
      [join(PLUGIN_SCRIPTS, name), `plugin/scripts/${name}`, readFileSync(join(dir, name))],
    ]),
    [MOD_BUNDLE, "plugin/hooks/register.mjs", freshMod],
  ];
  for (const [path, label, built] of targets) {
    const committed = read(path);
    if (!committed || !built.equals(committed)) {
      console.error(`${label} is out of date with src/. Run \`npm run build\` and commit it.`);
      process.exit(1);
    }
  }
  console.log(`${targets.map(([, label]) => label).join(", ")} are up to date`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
