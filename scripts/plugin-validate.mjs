import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./bundle.mjs";

const PLUGIN = join(ROOT, "plugin");
const isWindows = process.platform === "win32";

const claude = (args) =>
  spawnSync(isWindows ? "claude.cmd" : "claude", args, { cwd: ROOT, encoding: "utf8", shell: isWindows });

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const shapeProblems = () => {
  const problems = [];
  const manifest = readJson(join(PLUGIN, ".claude-plugin", "plugin.json"));
  const market = readJson(join(ROOT, ".claude-plugin", "marketplace.json"));
  const hooks = readJson(join(PLUGIN, "hooks", "hooks.json"));
  const version = readJson(join(ROOT, "package.json")).version;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name ?? "")) problems.push("plugin.json name is not kebab-case");
  if (manifest.version !== version) problems.push(`plugin.json version ${manifest.version} is not ${version}`);
  if (typeof market.name !== "string" || typeof market.owner?.name !== "string")
    problems.push("marketplace needs name and owner.name");
  const entry = (market.plugins ?? []).find((plugin) => plugin.name === manifest.name);
  if (entry === undefined || entry.source !== "./plugin") problems.push("marketplace entry must point to ./plugin");
  if (entry?.version !== undefined) problems.push("marketplace entry must not set version");
  if (typeof hooks.hooks !== "object" || hooks.hooks === null) problems.push("hooks.json needs a top-level hooks key");
  if (existsSync(join(PLUGIN, "bin"))) problems.push("plugin must not have a bin/ directory");
  for (const name of readdirSync(join(PLUGIN, "skills"))) {
    const text = readFileSync(join(PLUGIN, "skills", name, "SKILL.md"), "utf8");
    if (!/^---\nname: [a-z-]+\ndescription: /.test(text)) problems.push(`skills/${name}/SKILL.md frontmatter`);
  }
  return problems;
};

const probe = claude(["--version"]);
if (probe.status === 0) {
  for (const target of ["plugin", "."]) {
    const result = claude(["plugin", "validate", "--strict", target]);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(`validated with claude plugin validate --strict (${probe.stdout.trim()})`);
} else {
  const problems = shapeProblems();
  for (const problem of problems) console.error(`plugin: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log("validated with the built-in shape check (claude not found)");
}
