import assert from "node:assert/strict";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { readBook, writeBook } from "../src/conceitos/book.js";
import { LEGACY_CONCEPTS, LEGACY_NAMES } from "../src/conceitos/concepts.js";
import { conceptSummaries, readConceptEvents, recordConceptEvents } from "../src/conceitos/evidence.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field } from "./support.js";

const PROJECT = toAbsolutePath(join("/", "home", "ana", "project"));
const PATHS = fmPaths(PROJECT);
const at = (path: string) => toAbsolutePath(join(PROJECT, path));
const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const OLD_BOOK = [
  "schema: finitemonkey/conceitos@1",
  "baseline_green: 4",
  "alarm_green: -1",
  "concepts:",
  ...LEGACY_NAMES.flatMap((name, index) => [
    `  ${name}:`,
    `    level: ${index % 2 === 0 ? "predicted" : "seen"}`,
    `    updated_at: 2026-10-0${String((index % 9) + 1)}T00:00:00Z`,
    ...(name === "webhook" ? ["    streak: 3", "    demonstrated: true"] : []),
  ]),
  "",
].join("\n");

const OLD_EVENTS = [
  { at: "2026-10-01T00:00:00Z", concept: "webhook", kind: "own_change", origin: "person", weight: 1, file: "a.js" },
  { at: "2026-10-02T00:00:00Z", concept: "webhook", kind: "own_repair", origin: "person", weight: 1.5 },
  { at: "2026-10-03T00:00:00Z", concept: "migration", kind: "exposure", origin: "agent", weight: 0 },
]
  .map((item) => `${JSON.stringify(item)}\n`)
  .join("");

const oldProject = (): MemoryFs =>
  memoryFs({
    [at(".git/HEAD")]: "ref: refs/heads/main\n",
    [at(".fm/config.yml")]: "lang: en\n",
    [at(".fm/conceitos.yml")]: OLD_BOOK,
    [at(".fm/conceitos-events.jsonl")]: OLD_EVENTS,
  });

describe("concept books with the eight old ids migrate", () => {
  it("every old id maps to its hierarchical id with level, streak and demonstration intact", () => {
    const runtime = fakeRuntime({ fs: oldProject() });
    const book = readBook(runtime, PATHS);
    assert.deepEqual(Object.keys(book.concepts).sort(), Object.values(LEGACY_CONCEPTS).sort());
    assert.equal(book.baselineGreen, 4);
    const webhook = book.concepts["backend/integration/webhook"];
    assert.deepEqual([webhook?.streak, webhook?.demonstrated], [3, true]);
    assert.equal(book.concepts["backend/api/endpoint"]?.level, "predicted");
    assert.equal(book.concepts["backend/data/migration"]?.level, "seen");
    writeBook(runtime, PATHS, book);
    assert.deepEqual(readBook(runtime, PATHS), book);
  });

  it("old evidence lines read under the new ids with kind, weight and file intact", () => {
    const runtime = fakeRuntime({ fs: oldProject() });
    const events = readConceptEvents(runtime, PATHS);
    assert.deepEqual(
      events.map((item) => [item.concept, item.kind, item.weight, item.file ?? null]),
      [
        ["backend/integration/webhook", "own_change", 1, "a.js"],
        ["backend/integration/webhook", "own_repair", 1.5, null],
        ["backend/data/migration", "exposure", 0, null],
      ],
    );
    const webhook = conceptSummaries(runtime, PATHS).find((item) => item.concept === "backend/integration/webhook");
    assert.deepEqual([webhook?.positive, webhook?.domain], [2, "backend"]);
  });
});

describe("the person renames, merges and forgets concepts", () => {
  const run = (fs: MemoryFs, ...argv: readonly string[]) =>
    cliJson(["conceitos", ...argv], { cwd: PROJECT, runtime: fakeRuntime({ fs }), stdin: tty(), env: {} });

  it("rename moves the level and the evidence to the new id", async () => {
    const fs = oldProject();
    const renamed = await run(fs, "rename", "webhook", "backend/integration/inbound-webhook");
    assert.equal(renamed.code, 0, renamed.stdout);
    const runtime = fakeRuntime({ fs });
    assert.equal(readBook(runtime, PATHS).concepts["backend/integration/inbound-webhook"]?.demonstrated, true);
    assert.equal(readBook(runtime, PATHS).concepts["backend/integration/webhook"], undefined);
    assert.ok(
      readConceptEvents(runtime, PATHS)
        .filter((item) => item.kind !== "exposure")
        .every((item) => item.concept === "backend/integration/inbound-webhook"),
    );
    recordConceptEvents(runtime, PATHS, [{ concept: "webhook", kind: "own_change", origin: "person" }]);
    assert.equal(readConceptEvents(runtime, PATHS).at(-1)?.concept, "backend/integration/inbound-webhook");
  });

  it("merge joins the evidence of both under the second, and rename onto an existing id is refused", async () => {
    const fs = oldProject();
    const refused = await run(fs, "rename", "migration", "backend/integration/webhook");
    assert.notEqual(refused.code, 0);
    const merged = await run(fs, "merge", "migration", "backend/integration/webhook");
    assert.equal(merged.code, 0, merged.stdout);
    const events = readConceptEvents(fakeRuntime({ fs }), PATHS);
    assert.equal(events.filter((item) => item.concept === "backend/integration/webhook").length, 3);
  });

  it("forget drops the concept from the book and from what is recognized or read", async () => {
    const fs = oldProject();
    const forgot = await run(fs, "forget", "backend/integration/webhook");
    assert.equal(forgot.code, 0, forgot.stdout);
    const runtime = fakeRuntime({ fs });
    assert.equal(readBook(runtime, PATHS).concepts["backend/integration/webhook"], undefined);
    assert.ok(readConceptEvents(runtime, PATHS).every((item) => item.concept !== "backend/integration/webhook"));
    assert.deepEqual(
      recordConceptEvents(runtime, PATHS, [{ concept: "webhook", kind: "own_change", origin: "person" }]),
      [],
    );
  });

  it("an unknown concept or a call without a person is refused", async () => {
    const fs = oldProject();
    assert.notEqual((await run(fs, "forget", "backend/money/rounding")).code, 0);
    const agent = await cliJson(["conceitos", "forget", "webhook"], {
      cwd: PROJECT,
      runtime: fakeRuntime({ fs }),
      env: {},
    });
    assert.notEqual(agent.code, 0);
    assert.equal(field(agent.body, "error", "code"), "needs_confirmation");
  });
});
