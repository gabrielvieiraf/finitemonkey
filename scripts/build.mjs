import { relative } from "node:path";

import { bundle, bundleMod, copyToPlugin, ROOT } from "./bundle.mjs";

const built = await bundle();
const copied = copyToPlugin();
const mod = await bundleMod();
const names = [...built, ...copied, mod].map((path) => relative(ROOT, path));
console.log(`built ${names.join(", ")}`);
