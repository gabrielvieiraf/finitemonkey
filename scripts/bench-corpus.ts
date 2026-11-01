import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parseJsonObject } from "../src/core/parsed.js";
import { appendSessionCase, buildSessionCase, maskedSecret, sessionRoots } from "./bench-corpus-session.js";

const USAGE = [
  "npm run bench:corpus -- add --from-session <payload.json> --guard <guard> --expect block|allow --id <id> [--note <text>] [--yes]",
  "  masks paths, hosts and secrets in a PreToolUse payload from a real session, shows the case,",
  "  and adds it to bench/corpus/<guard>/cases.jsonl with origin session only after you say yes; nothing leaves the machine",
].join("\n");

const fail = (message: string): never => {
  console.error(`bench:corpus: ${message}\n\n${USAGE}`);
  process.exit(2);
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: true,
  options: {
    "from-session": { type: "string" },
    guard: { type: "string" },
    expect: { type: "string" },
    id: { type: "string" },
    note: { type: "string" },
    yes: { type: "boolean" },
  },
});

if (positionals[0] !== "add") fail("the only subcommand is add");
const source = values["from-session"] ?? fail("--from-session is required");
const guard = values.guard ?? fail("--guard is required");
const raw = parseJsonObject(readFileSync(source, "utf8"));
const payload = raw.ok ? raw.value : fail(`${source}: ${raw.error}`);
const built = buildSessionCase(payload, {
  guard,
  expect: values.expect ?? fail("--expect is required"),
  id: values.id ?? fail("--id is required"),
  note: values.note ?? "",
  roots: sessionRoots(payload, [homedir()]),
});
const record = built.ok ? built.value : fail(built.error);

console.log(JSON.stringify(record, null, 2));
if (maskedSecret(record)) {
  console.log("a secret was masked; for a secrets case replace the mask with a {{sample:<name>}} placeholder by hand");
}
const confirmed =
  values.yes === true ||
  (process.stdin.isTTY &&
    (await (async () => {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await prompt.question(`add this case to bench/corpus/${guard}? [y/N] `);
      prompt.close();
      return /^y(es)?$/i.test(answer.trim());
    })()));
if (!confirmed) fail("not added: answer y at a terminal, or pass --yes after reading the masked case");

const corpus = join(fileURLToPath(new URL("..", import.meta.url)), "bench", "corpus");
const added = appendSessionCase(corpus, guard, record);
if (!added.ok) fail(added.error);
console.log(`added to ${added.ok ? added.value : ""}`);
