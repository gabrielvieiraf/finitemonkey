import { relative } from "node:path";

import { bundle, ROOT } from "./bundle.mjs";

const outfile = await bundle();
console.log(`built ${relative(ROOT, outfile)}`);
