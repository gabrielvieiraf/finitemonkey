import assert from "node:assert/strict";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { bookPath, readBookFile } from "../src/conceitos/book.js";
import { criteriaEvents } from "../src/conceitos/change.js";
import { packageMapOf } from "../src/conceitos/packages.js";
import { type Recognition, recognizeCriteria, recognizeResearch } from "../src/conceitos/recognize.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { conceptBand } from "../src/judge/band.js";
import { parseEntry } from "../src/judge/parse.js";
import { readEntries } from "../src/judge/store.js";
import { profileFromLog, profileRecords, renderProfile } from "../src/perfil/log.js";
import { parseProfile } from "../src/perfil/store.js";
import { startingProfile } from "../src/perfil/types.js";
import { blindBand, openBlindBand, recordHorizon } from "../src/signals/blind-band.js";
import { fmPaths } from "../src/task/paths.js";
import { domainsOfEdit } from "../src/teach/blueprint-first.js";
import { memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field } from "./support.js";

const PROJECT = toAbsolutePath(join("/", "home", "ana", "project"));
const PATHS = fmPaths(PROJECT);
const at = (path: string) => toAbsolutePath(join(PROJECT, path));
const AT = "2026-10-20T10:00:00.000Z";

const pairs = (found: readonly Recognition[]): readonly (readonly [string, string, string])[] =>
  found.map((item) => [item.concept, item.source, item.match]);

const project = () =>
  fakeRuntime({
    fs: memoryFs({ [at(".git/HEAD")]: "ref: refs/heads/main\n", [at(".fm/config.yml")]: "lang: en\n" }),
  });

const tty = () => Object.assign(Readable.from([""]), { isTTY: true });

describe("concepts from the contract and the research question", () => {
  it("the contract's checks and criteria text place concepts by path, never by words alone", () => {
    const criteria = [
      { run: "node --test test/timezones.test.ts" },
      { description: "Totals keep cents (see src/billing/rounding.ts)." },
      { description: "the logout and the money rounding behave" },
    ];
    assert.deepEqual(pairs(recognizeCriteria(criteria)), [
      ["backend/time/timezone", "check", "test/timezones.test.ts"],
      ["backend/money/rounding", "check", "src/billing/rounding.ts"],
    ]);
    const seen = [{ concept: "backend/time/timezone", kind: "own_change" as const, origin: "person" as const }];
    assert.deepEqual(
      criteriaEvents(criteria, "t1", seen).map((item) => [item.concept, item.kind, item.origin, item.source]),
      [["backend/money/rounding", "exposure", "agent", "check"]],
    );
  });

  it("the research question and decision add the sources and files they cite", () => {
    const found = recognizeResearch({
      slug: "creatine",
      urls: ["https://example.com/blog"],
      question: "Does creatine help? Start from https://pubmed.ncbi.nlm.nih.gov/42/.",
      decision: "Ship the dose table in src/billing/rounding.ts if the evidence holds",
    });
    assert.deepEqual(pairs(found), [
      ["research/health/creatine", "research", "https://pubmed.ncbi.nlm.nih.gov/42/"],
      ["backend/money/rounding", "research", "src/billing/rounding.ts"],
    ]);
    assert.deepEqual(recognizeResearch({ slug: "creatine", urls: [], question: "health, law, money" }), []);
  });

  it("the blueprint prompt reads the person's package map", () => {
    const fs = memoryFs({
      [at(".fm/conceitos-map.json")]: JSON.stringify({ packages: { "acme-auth": "security/session/x" } }),
    });
    const runtime = fakeRuntime({ fs });
    const text = 'import { login } from "acme-auth";';
    assert.deepEqual(domainsOfEdit("src/a.ts", text), ["product"]);
    assert.deepEqual(domainsOfEdit("src/a.ts", text, packageMapOf(runtime, PATHS)), ["security"]);
  });
});

describe("open top-level fields", () => {
  it("a profile keeps a new field through the log and the yaml", () => {
    const start = startingProfile(AT);
    const next = { ...start, fields: { research: { tool: 40, knowledge: 20 } } };
    const records = profileRecords(AT, start, next);
    assert.deepEqual(
      records.map((record) => record["domain"]),
      ["research"],
    );
    const logged = profileFromLog(records.flatMap((record) => parseEntry(record) ?? []));
    assert.deepEqual(logged?.fields, { research: { tool: 40, knowledge: 20 } });
    const yaml = renderProfile(next);
    assert.match(yaml, /research:/);
    assert.deepEqual(parseProfile(yaml, AT).fields, { research: { tool: 40, knowledge: 20 } });
    assert.equal(parseProfile(renderProfile(start), AT).fields, undefined);
  });

  it("blind-band@2 keys rows by the concept's own field while @1 keeps folding it into general", () => {
    const runtime = project();
    recordHorizon(runtime, PATHS, { source: "concept", criterion: "none", domain: "general", field: "research" });
    recordHorizon(runtime, PATHS, { source: "clarify", criterion: "none", domain: "backend" });
    const log = runtime.readText(PATHS.log);
    const text = log.ok ? log.value : "";
    assert.deepEqual(
      blindBand(runtime, PATHS, text).rows.map((row) => row.domain),
      ["backend", "general"],
    );
    const open = openBlindBand(runtime, PATHS, text);
    assert.equal(open.schema, "finitemonkey/blind-band@2");
    assert.deepEqual(
      open.rows.map((row) => row.domain),
      ["backend", "research"],
    );
  });
});

describe("the concept book is a view over the judge log", () => {
  it("levels written by mark show the same before and after the book file is gone", async () => {
    const runtime = project();
    const opts = { cwd: PROJECT, runtime, stdin: tty() };
    await cliJson(["conceitos", "mark", "backend/api/endpoint", "used"], { ...opts, stdin: tty() });
    await cliJson(["conceitos", "mark", "security/session/logout", "explained"], { ...opts, stdin: tty() });
    const before = await cliJson(["conceitos"], { cwd: PROJECT, runtime });
    const file = readBookFile(runtime, PATHS);
    assert.deepEqual(field(before.body, "data", "concepts"), {
      "backend/api/endpoint": { level: "used", updatedAt: file.concepts["backend/api/endpoint"]?.updatedAt },
      "security/session/logout": { level: "explained", updatedAt: file.concepts["security/session/logout"]?.updatedAt },
    });
    assert.ok(runtime.remove(bookPath(PATHS)).ok);
    const after = await cliJson(["conceitos"], { cwd: PROJECT, runtime });
    assert.deepEqual(after.body, before.body);
    const band = conceptBand("backend/api/endpoint", readEntries(runtime, PATHS));
    assert.deepEqual([band.band, band.exposures], ["no record", 0]);
  });
});
