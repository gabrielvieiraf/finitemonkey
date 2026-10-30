import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { ConceptId } from "../src/conceitos/concepts.js";
import type { ConceptState } from "../src/conceitos/evidence.js";
import { ABILITY, DESCRIBED_PREFIXES, wordingProblems } from "../src/conceitos/wording.js";
import { type CriterionRef, xrayOf } from "../src/conceitos/xray.js";
import { saveXray } from "../src/conceitos/xray-run.js";
import type { AddedLine } from "../src/gate/git.js";
import { blindBand } from "../src/signals/blind-band.js";
import { fmPaths } from "../src/task/paths.js";
import { runtime, type TempRepo, tempRepo } from "./git-support.js";
import { ROOT } from "./support.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const lines = (path: string, start: number, ...texts: readonly string[]): readonly AddedLine[] =>
  texts.map((text, index) => ({ path, line: start + index, text }));

const ADDED: readonly AddedLine[] = [
  ...lines("src/payments/webhook.ts", 10, "export const onWebhook = (event) => {", "  return store(event);", "};"),
  ...lines("src/payments/refund.ts", 3, "const key = idempotency(request);"),
  ...lines("db/migrations/0042.sql", 1, "alter table orders add column refunded int;"),
  ...lines("src/api/orders.ts", 7, "router.get('/orders', list);"),
  ...lines("src/util/format.ts", 1, "export const money = (cents) => cents / 100;"),
];

const STATES: ReadonlyMap<ConceptId, ConceptState> = new Map<ConceptId, ConceptState>([
  ["webhook", "beyond"],
  ["idempotency", "beyond"],
  ["migration", "proximal"],
  ["api", "demonstrated"],
]);

const REFS: readonly CriterionRef[] = [
  { id: "E1", kind: "example", mentions: ["node scripts/refund.js 50"], decorative: false },
  { id: "C2", kind: "check", mentions: ["psql -f db/migrations/0042.sql"], decorative: true },
  {
    id: "T",
    kind: "tests",
    mentions: ["node --test", "import { list } from '../src/api/orders.js'"],
    decorative: false,
  },
];

const catalog = (language: string): Readonly<Record<string, string>> => {
  const parsed: unknown = JSON.parse(readFileSync(join(ROOT, "src", "i18n", `${language}.json`), "utf8"));
  assert.ok(typeof parsed === "object" && parsed !== null);
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

describe("x-ray", () => {
  it("a fixture diff produces the expected band × coverage grid, beyond × no criterion first", () => {
    const xray = xrayOf({ added: ADDED, states: STATES, refs: REFS, agentFiles: new Set(["src/payments/webhook.ts"]) });
    assert.deepEqual(xray.grid, {
      beyond: { none: 1, decorative: 0, covered: 1 },
      unknown: { none: 1, decorative: 0, covered: 0 },
      edge: { none: 0, decorative: 1, covered: 0 },
      within: { none: 0, decorative: 0, covered: 1 },
    });
    assert.equal(xray.beyondWithoutCriterion, 1);
    assert.equal(xray.items[0]?.by, "agent");
    assert.deepEqual(
      xray.items.map((item) => [item.file, item.band, item.coverage]),
      [
        ["src/payments/webhook.ts", "beyond", "none"],
        ["src/payments/refund.ts", "beyond", "covered"],
        ["src/util/format.ts", "unknown", "none"],
        ["db/migrations/0042.sql", "edge", "decorative"],
        ["src/api/orders.ts", "within", "covered"],
      ],
    );
  });

  it("the beyond × no criterion count feeds the blind band index once per tree", () => {
    const repo = tempRepo();
    repos.push(repo);
    const paths = fmPaths(repo.root);
    runtime.mkdir(paths.dir);
    const xray = xrayOf({ added: ADDED, states: STATES, refs: REFS, agentFiles: new Set() });
    assert.deepEqual(saveXray(runtime, paths, "t1", "tree-a", xray), { recorded: 2 });
    assert.deepEqual(saveXray(runtime, paths, "t1", "tree-a", xray), { recorded: 0 });
    const log = runtime.readText(paths.log);
    const report = blindBand(runtime, paths, log.ok ? log.value : "");
    assert.equal(report.total.helps, 2);
    assert.equal(report.total.withoutCriterion, 1);
  });

  it("no message in the catalogs addresses the person's ability", () => {
    for (const language of ["en", "pt-BR", "es"]) {
      for (const [key, text] of Object.entries(catalog(language))) {
        const ability = ABILITY.filter((pattern) => pattern.test(text)).map(String);
        assert.deepEqual(ability, [], `${language} ${key}: ${text}`);
        if (DESCRIBED_PREFIXES.some((prefix) => key.startsWith(prefix)))
          assert.deepEqual(wordingProblems(text), [], `${language} ${key}: ${text}`);
      }
    }
  });

  it("the wording table rejects sentences about the person and keeps sentences about the record", () => {
    for (const bad of [
      "you are a beginner in auth",
      "your knowledge of webhooks is weak",
      "você não sabe idempotência",
      "tu nivel en migraciones",
    ])
      assert.notDeepEqual(wordingProblems(bad), [], bad);
    for (const good of [
      "no own prediction, change or repair on record",
      "you predicted 3 of 4",
      "written by the agent",
    ])
      assert.deepEqual(wordingProblems(good), [], good);
  });
});
