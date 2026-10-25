import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { ROOT } from "./bundle.mjs";

const BASE = process.argv[2] ?? ROOT;
const PLUGIN = join(BASE, "plugin");
const PIN = /finitemonkey@\d[0-9A-Za-z.+-]*/g;

const version = JSON.parse(readFileSync(join(BASE, "package.json"), "utf8")).version;

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

const stamp = (path) => {
  const before = readFileSync(path, "utf8");
  let after = before.replace(PIN, `finitemonkey@${version}`);
  if (path.endsWith("plugin.json")) after = after.replace(/"version": "[^"]*"/, `"version": "${version}"`);
  if (after === before) return false;
  writeFileSync(path, after);
  return true;
};

const changed = files(PLUGIN)
  .filter((path) => /\.(json|md)$/.test(path))
  .filter(stamp)
  .map((path) => relative(BASE, path));
console.log(changed.length === 0 ? `plugin already at ${version}` : `plugin stamped ${version}: ${changed.join(", ")}`);
