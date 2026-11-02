import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parseJson } from "../src/core/parsed.js";
import { heldoutProblem } from "./bench-cli.js";
import { type Family, loadFamilies } from "./bench-family.js";
import { analyse } from "./bench-people-analysis.js";
import { parseDataset } from "./bench-people-data.js";
import { balance, parseProtocol, plannedSession, schedule, type Slot } from "./bench-people-plan.js";
import { renderReport } from "./bench-people-report.js";
import { intentsFor, materialize, splitOracleFor, varsFor } from "./bench-suite.js";
import { jsonLines } from "./bench-transcript.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const PROTOCOL = join(repo, "bench", "people", "protocol.json");
const PREREG = join(repo, "docs", "bench", "people.md");

const USAGE = [
  "npm run bench:people -- schedule",
  "  prints every slot's tasks, order and arm, fixed by the seed in bench/people/protocol.json",
  "npm run bench:people -- prepare --slot <B01> --task <family> --out <empty dir outside this repository>",
  "  writes that session's starting repository and prints the task card",
  "npm run bench:people -- score --slot <B01> --task <family> --dir <session folder>",
  "  runs the hidden oracle on the folder and prints oracleGreen and trapGreen",
  "npm run bench:people -- analyse --data <dir with participants.jsonl and sessions.jsonl> [--out report.md]",
  "  the pre-registered analysis of docs/bench/people.md",
].join("\n");

const fail = (message: string): never => {
  console.error(`bench:people: ${message}\n\n${USAGE}`);
  process.exit(2);
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    protocol: { type: "string" },
    slot: { type: "string" },
    task: { type: "string" },
    out: { type: "string" },
    dir: { type: "string" },
    data: { type: "string" },
  },
});

const protocolFile = values.protocol ?? PROTOCOL;
const parsedJson = parseJson(readFileSync(protocolFile, "utf8"));
const protocol = parseProtocol(parsedJson.ok ? parsedJson.value : undefined);
if (!protocol.ok) fail(`${protocolFile}: ${protocol.error}`);
const slots: readonly Slot[] = protocol.ok ? schedule(protocol.value) : [];
const tasks = protocol.ok ? protocol.value.tasks : [];

const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

const sessionOf = () => {
  const found = plannedSession(
    slots,
    values.slot ?? fail("--slot is required"),
    values.task ?? fail("--task is required"),
  );
  return found ?? fail(`no scheduled session for ${values.slot ?? ""} and ${values.task ?? ""}`);
};

const familyOf = (id: string): Family => {
  const loaded = loadFamilies(join(repo, "bench", "tasks"), "public");
  const family = loaded.ok ? loaded.value.find((item) => item.id === id) : undefined;
  return family ?? fail(loaded.ok ? `unknown task family ${id}` : loaded.error);
};

const printSchedule = (): void => {
  console.log("| Slot | Profile | Spare | Position | Task | Arm | Task seed |");
  console.log("|---|---|---|---|---|---|---|");
  for (const slot of slots)
    for (const session of slot.sessions)
      console.log(
        `| ${slot.id} | ${slot.profile} | ${slot.spare ? "yes" : "no"} | ${String(session.position)} | ${session.task} | ${session.arm} | ${String(session.taskSeed)} |`,
      );
  console.log("\nTask balance over the primary slots:");
  for (const row of balance(slots, tasks))
    console.log(`- ${row.task}: fm ${String(row.fm)}, plain ${String(row.plain)}`);
};

const prepare = (): void => {
  const { session } = sessionOf();
  const out = values.out ?? fail("--out is required");
  const problem = heldoutProblem(repo, out);
  if (problem !== undefined) fail("the session folder must live outside this repository");
  if (existsSync(out) && readdirSync(out).length > 0) fail(`${out} is not empty`);
  const family = familyOf(session.task);
  const vars = varsFor(family, session.taskSeed);
  materialize(family, out, vars);
  const intents = intentsFor(family, vars);
  console.log(`Session ${session.slot} #${String(session.position)}: ${session.task}, arm ${session.arm}`);
  console.log(`\nGoal: ${intents.goal}\nDone when: ${intents.acceptance}\nConstraints: ${intents.constraints}`);
};

const score = (): void => {
  const { session } = sessionOf();
  const dir = values.dir ?? fail("--dir is required");
  const family = familyOf(session.task);
  const result = splitOracleFor(family, dir, varsFor(family, session.taskSeed));
  console.log(
    JSON.stringify({
      participant: session.slot,
      task: session.task,
      oracleGreen: result.green,
      trapGreen: result.trapGreen,
    }),
  );
};

const analyseData = (): void => {
  const dir = values.data ?? fail("--data is required");
  const read = (name: string) => jsonLines(readFileSync(join(dir, name), "utf8"));
  const dataset = parseDataset(read("participants.jsonl"), read("sessions.jsonl"), slots);
  if (!dataset.ok) fail(dataset.error.join("\n"));
  if (!dataset.ok) return;
  const hashes = Object.fromEntries([PREREG, protocolFile].map((file) => [relative(repo, file), sha256(file)]));
  const text = renderReport({ analysis: analyse(dataset.value, slots), hashes });
  if (values.out === undefined) console.log(text);
  else writeFileSync(values.out, text);
};

const steps: Readonly<Record<string, () => void>> = { schedule: printSchedule, prepare, score, analyse: analyseData };
const step = steps[positionals[0] ?? ""];
if (step === undefined) fail(`unknown step ${positionals[0] ?? "(none)"}`);
else step();
