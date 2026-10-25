import { relative } from "node:path";

import { bundle, copyToPlugin, ROOT } from "./bundle.mjs";

const outfile = await bundle();
console.log(`built ${relative(ROOT, outfile)} and ${relative(ROOT, copyToPlugin(outfile))}`);
