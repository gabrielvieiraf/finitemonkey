import { relative } from "node:path";

import { bundle, bundleMod, copyToPlugin, ROOT } from "./bundle.mjs";

const outfile = await bundle();
const mod = await bundleMod();
console.log(`built ${relative(ROOT, outfile)}, ${relative(ROOT, copyToPlugin(outfile))} and ${relative(ROOT, mod)}`);
