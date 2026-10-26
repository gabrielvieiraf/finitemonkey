import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { generateSchemas, ROOT, SCHEMA_DIR, staleSchemas } from "./schema-gen.js";

const readOrEmpty = (path: string): string => {
  try {
    return readFileSync(join(ROOT, path), "utf8");
  } catch {
    return "";
  }
};

const committed = (): readonly string[] => {
  try {
    return readdirSync(join(ROOT, SCHEMA_DIR))
      .filter((name) => name.endsWith(".json"))
      .map((name) => `${SCHEMA_DIR}/${name}`);
  } catch {
    return [];
  }
};

const fresh = generateSchemas();

if (process.argv.includes("--check")) {
  const problems = staleSchemas(fresh, committed(), readOrEmpty);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error("Run `npm run schema` and commit docs/schema/.");
    process.exit(1);
  }
  console.log(`${String(fresh.size)} schemas in ${SCHEMA_DIR} are up to date`);
} else {
  for (const [path, text] of fresh) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), text);
  }
  console.log(`wrote ${String(fresh.size)} schemas to ${SCHEMA_DIR}`);
}
