import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { evidenceNotes } from "./evidence-notes-lib.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { root: { type: "string" }, version: { type: "string" } },
  strict: true,
});

const root = values.root ?? fileURLToPath(new URL("..", import.meta.url));
process.stdout.write(evidenceNotes(root, values.version));
