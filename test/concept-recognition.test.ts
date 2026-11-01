import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { changeEvents } from "../src/conceitos/change.js";
import { resolveConcept } from "../src/conceitos/concepts.js";
import { readConceptEvents, recordConceptEvents, stateOf, summarize } from "../src/conceitos/evidence.js";
import { recordFindingConcepts } from "../src/conceitos/findings.js";
import { packageMapOf } from "../src/conceitos/packages.js";
import {
  conceptOfCwe,
  NO_PACKAGES,
  type Recognition,
  recognizeChecks,
  recognizeCode,
  recognizeFindings,
  recognizeResearch,
} from "../src/conceitos/recognize.js";
import { researchEvents } from "../src/conceitos/research.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { AddedLine } from "../src/gate/git.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const PROJECT = toAbsolutePath(join("/", "home", "ana", "project"));
const PATHS = fmPaths(PROJECT);
const at = (path: string) => toAbsolutePath(join(PROJECT, path));

const pairs = (found: readonly Recognition[]): readonly (readonly [string, string])[] =>
  found.map((item) => [item.concept, item.source]);

const code = (file: string, ...lines: readonly string[]): readonly (readonly [string, string])[] =>
  pairs(recognizeCode({ file, lines }));

describe("concept recognition from what the work touches", () => {
  it("money rounding is recognized from the decimal library imported and the cents arithmetic", () => {
    assert.deepEqual(code("src/billing/total.ts", 'import Decimal from "decimal.js";'), [
      ["backend/money/rounding", "import"],
    ]);
    assert.deepEqual(code("src/cart.ts", "const cents = Math.round(price * 100);"), [
      ["backend/money/rounding", "api"],
    ]);
    assert.deepEqual(code("app/tax.py", "from decimal import Decimal, ROUND_HALF_UP"), [
      ["backend/money/rounding", "import"],
    ]);
  });

  it("time zones are recognized from Intl.DateTimeFormat and a timezone library", () => {
    assert.deepEqual(
      code("src/schedule.ts", 'const f = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });'),
      [["backend/time/timezone", "api"]],
    );
    assert.deepEqual(code("src/when.ts", 'import { formatInTimeZone } from "date-fns-tz";'), [
      ["backend/time/timezone", "import"],
    ]);
  });

  it("sessions and logout are recognized from the session calls and the session dependency", () => {
    assert.deepEqual(code("src/auth/out.ts", "req.session.destroy(() => res.redirect('/'));"), [
      ["security/session/logout", "api"],
      ["security/session/cookie", "api"],
    ]);
    assert.deepEqual(code("package.json", '    "express-session": "^1.18.0",'), [
      ["security/session/cookie", "dependency"],
    ]);
  });

  it("injection is recognized from raw HTML sinks and SQL built from a template", () => {
    assert.deepEqual(code("src/search.ts", "results.innerHTML = `<li>${query}</li>`;"), [
      ["security/injection/xss", "api"],
    ]);
    assert.deepEqual(code("src/notes.ts", "await db.query(`select * from notes where id = ${id}`);"), [
      ["security/injection/sql", "api"],
    ]);
  });

  it("authorization is recognized from an owner check against the request user and a policy library", () => {
    assert.deepEqual(code("src/notes/get.ts", "if (note.ownerId !== req.user.id) return res.status(404).end();"), [
      ["security/authorization/access-control", "api"],
    ]);
    assert.deepEqual(code("src/ability.ts", 'import { defineAbility } from "@casl/ability";'), [
      ["security/authorization/access-control", "import"],
    ]);
  });

  it("a research field is recognized from the cited sources, named after the research record", () => {
    assert.deepEqual(
      pairs(
        recognizeResearch({
          slug: "supplement-evidence",
          urls: ["https://pubmed.ncbi.nlm.nih.gov/123456/", "https://example.com/blog"],
        }),
      ),
      [["research/health/supplement-evidence", "research"]],
    );
    assert.deepEqual(pairs(recognizeResearch({ slug: "retention-rule", urls: ["https://eur-lex.europa.eu/x"] })), [
      ["research/law/retention-rule", "research"],
    ]);
    assert.deepEqual(
      researchEvents("supplement-evidence", "https://www.who.int/news", "agent").map((item) => [
        item.concept,
        item.kind,
        item.source,
      ]),
      [["research/health/supplement-evidence", "exposure", "research"]],
    );
  });

  it("security findings map to concepts through their CWE class, and an unknown class opens a new concept", () => {
    assert.equal(conceptOfCwe(79), "security/injection/xss");
    assert.equal(conceptOfCwe(639), "security/authorization/access-control");
    assert.deepEqual(pairs(recognizeFindings(["CWE-89", "cwe-1321"])), [
      ["security/injection/sql", "cwe"],
      ["security/cwe/cwe-1321", "cwe"],
    ]);
  });

  it("appsec findings record their concept through the rule's CWE, as exposure only", () => {
    const runtime = fakeRuntime({ fs: memoryFs({ [at(".finitemonkey/config.yml")]: "lang: en\n" }) });
    const events = recordFindingConcepts(
      runtime,
      PATHS,
      [
        { rule: "owner-filter", file: "src/notes.ts" },
        { rule: "sql-concat", file: "src/db.ts" },
      ],
      "t1",
    );
    assert.deepEqual(
      events.map((item) => [item.concept, item.source, item.match, item.kind, item.weight]),
      [
        ["security/authorization/access-control", "cwe", "CWE-639", "exposure", 0],
        ["security/injection/sql", "cwe", "CWE-89", "exposure", 0],
      ],
    );
  });

  it("the check that runs is a source: its test path places the concept", () => {
    assert.deepEqual(pairs(recognizeChecks(["node --test test/timezones.test.ts"])), [
      ["backend/time/timezone", "check"],
    ]);
  });

  it("prose that only talks about a concept is not recognized", () => {
    assert.deepEqual(code("notes.md", "We should fix the rounding of money, the timezone and the logout."), []);
    assert.deepEqual(code("src/plain.ts", "// rounding, timezone, session, xss, authorization"), []);
  });

  it("an installed package's own keywords and the person's map extend the shipped map", () => {
    const fs = memoryFs({
      [at("node_modules/tiny-money/package.json")]: JSON.stringify({ name: "tiny-money", keywords: ["Currency"] }),
      [at(".finitemonkey/conceitos-map.json")]: JSON.stringify({ packages: { "acme-ledger": "backend/money/ledger" } }),
    });
    const map = packageMapOf(fakeRuntime({ fs }), PATHS);
    assert.deepEqual(pairs(recognizeCode({ file: "src/a.ts", lines: ['import m from "tiny-money";'] }, map)), [
      ["backend/money/rounding", "import"],
    ]);
    assert.deepEqual(pairs(recognizeCode({ file: "src/b.ts", lines: ['import { post } from "acme-ledger";'] }, map)), [
      ["backend/money/ledger", "import"],
    ]);
    assert.deepEqual(recognizeCode({ file: "src/a.ts", lines: ['import m from "tiny-money";'] }, NO_PACKAGES), []);
  });
});

const added = (path: string, ...texts: readonly string[]): readonly AddedLine[] =>
  texts.map((text, index) => ({ path, line: index + 1, text }));

describe("model proposals stay in shadow", () => {
  it("a proposal is stored with origin model-proposed and never moves a band", () => {
    const runtime = fakeRuntime({ fs: memoryFs({ [at(".finitemonkey/config.yml")]: "lang: en\n" }) });
    const drafts = changeEvents(added("src/odd.ts", "export const f = (x) => x;"), {
      agentFiles: new Set(),
      repaired: true,
      task: "t1",
      proposer: () => ["backend/odd/thing", "not a concept"],
    });
    assert.deepEqual(
      drafts.map((item) => [item.concept, item.kind, item.origin, item.source]),
      [["backend/odd/thing", "exposure", "model-proposed", "model-proposed"]],
    );
    recordConceptEvents(runtime, PATHS, [
      ...drafts,
      { concept: "backend/odd/thing", kind: "own_repair", origin: "model-proposed" },
      { concept: "backend/odd/thing", kind: "prediction_right", origin: "model-proposed" },
    ]);
    const logged = readConceptEvents(runtime, PATHS);
    assert.ok(logged.every((item) => item.origin === "model-proposed" && item.weight === 0));
    assert.equal(stateOf(logged), "unknown");
    assert.equal(summarize("backend/odd/thing", logged).state, "unknown");
  });

  it("the proposer is not asked when the recognizer places the code, and a failing proposer adds nothing", () => {
    let asked = 0;
    const placed = changeEvents(added("src/a.ts", "const c = Math.round(v * 100);"), {
      agentFiles: new Set(),
      repaired: false,
      task: "t1",
      proposer: () => {
        asked += 1;
        return ["backend/odd/thing"];
      },
    });
    assert.equal(asked, 0);
    assert.deepEqual(
      placed.map((item) => [item.concept, item.origin]),
      [["backend/money/rounding", "person"]],
    );
    const failing = changeEvents(added("src/odd.ts", "export const f = 1;"), {
      agentFiles: new Set(),
      repaired: false,
      task: "t1",
      proposer: () => {
        throw new Error("offline");
      },
    });
    assert.deepEqual(failing, []);
  });

  it("without a proposer, unplaced code produces nothing", () => {
    const drafts = changeEvents(added("src/odd.ts", "export const f = 1;"), {
      agentFiles: new Set(),
      repaired: false,
      task: "t1",
    });
    assert.deepEqual(drafts, []);
    assert.equal(resolveConcept("Backend/Money/Rounding"), "backend/money/rounding");
  });
});
