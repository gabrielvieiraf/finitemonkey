import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { runChain, subcontracts } from "../src/autonomy/chain.js";
import { instructionDrift } from "../src/instructions/drift.js";
import { keepValid } from "../src/look/critic.js";
import { DEFAULT_POLICY } from "../src/policy/policy.js";
import {
  providerCritic,
  providerDeepSearch,
  providerInstructionConflicts,
  providerStance,
} from "../src/provider/adapters.js";
import { providerAgent } from "../src/provider/generators.js";
import type { ProviderKind } from "../src/provider/kinds.js";
import type { ResearchLog } from "../src/research/log.js";
import { sidesOf, suggestStance } from "../src/research/sides.js";
import type { TaskContract } from "../src/task/types.js";
import { answer, type FakeClaude, MALFORMED, world } from "./provider-support.js";

const both = (kind: ProviderKind, yes: FakeClaude) =>
  [MALFORMED, yes].map((fake) => ({ fake, yes: fake === yes, ...world({ kinds: [kind], mode: "active", fake }) }));

const UNKNOWN = "whether e-books count as books";
const SOURCE = "https://taxation.example.eu/ebooks";

const log = (stance: "favors" | undefined): ResearchLog => ({
  slug: "vat",
  question: {
    question: "is the reduced rate allowed",
    decision: "d",
    options: [],
    criteria: [],
    unknowns: [UNKNOWN],
    stop: "",
    risk: "normal",
    at: "",
  },
  sources: [
    {
      url: SOURCE,
      changed: "unknown",
      target: "",
      resolves: UNKNOWN,
      at: "",
      ...(stance === undefined ? {} : { stance, stanceBy: "model" as const }),
    },
  ],
  emptySearches: [],
});

const CONTRACT: TaskContract = {
  id: "mid",
  goal: "mid",
  size: "M",
  scope: { paths: ["src/"], testsProtected: true },
  acceptance: [{ id: "c1", kind: "command", run: "npm test" }],
  decisionsNeeded: [],
  implicit: false,
};

describe("a malformed or yes-saying model decides nothing", () => {
  it("stance: a suggested stance never counts as a confirmed side", () => {
    for (const w of both("stance", { answer: answer({ stance: "favors" }) })) {
      const proposed = suggestStance(providerStance(w.deps), SOURCE, UNKNOWN);
      assert.equal(proposed, w.yes ? "favors" : undefined);
      const [sides] = sidesOf(log(proposed === "favors" ? "favors" : undefined));
      assert.ok(sides !== undefined);
      assert.deepEqual(sides.favors, []);
      assert.equal(sides.open, true);
    }
  });

  it("instruction-conflicts: a proposed contradiction is labelled a proposal and malformed output adds none", () => {
    const yes = { answer: answer([{ first: { file: "AGENTS.md", line: 1 }, second: { file: "CLAUDE.md", line: 1 } }]) };
    for (const w of both("instruction-conflicts", yes)) {
      const findings = instructionDrift({
        files: [
          { path: "AGENTS.md", text: "Always use tabs.\n" },
          { path: "CLAUDE.md", text: "Never use tabs.\n" },
        ],
        project: { read: () => undefined, exists: () => false },
        tree: [],
        hasSymbol: () => new Set(),
        blame: () => null,
        conflicts: [],
        violations: new Map(),
        violationLimit: 3,
        proposer: providerInstructionConflicts(w.deps),
      });
      const contradictions = findings.flatMap((item) => (item.kind === "contradiction" ? [item.proposal] : []));
      assert.deepEqual(contradictions, w.yes ? [true] : []);
    }
  });

  it("retrieve-deep: malformed output gives no span and spans never become claims", () => {
    for (const w of both("retrieve-deep", { answer: answer([{ anchor: "src/a.ts:1", text: "supported" }]) })) {
      const spans = providerDeepSearch(w.deps)("where is the config parsed", 500);
      assert.equal(spans.length, w.yes ? 1 : 0);
      assert.equal(w.fs.read(join(w.paths.dir, "claims.jsonl")), undefined);
    }
  });

  it("critic: a critique outside the checklist is dropped and a missing ranking is never a pick", async () => {
    for (const w of both("critic", {
      answer: answer([{ heuristic: "correct", region: { x: 0 }, text: "supported" }]),
    })) {
      const input = { route: "/", viewport: 390, screenshot: "shot.png", contract: [], tokens: [] };
      const raw = await providerCritic(w.deps).critique(input);
      assert.deepEqual(keepValid(input, raw), []);
      await assert.rejects(providerCritic(w.deps).rank("a.png", "b.png", ["N1-status"]));
    }
  });

  it("agent: an agent that says it is done proves nothing; the gate decides", () => {
    for (const w of both("agent", { answer: answer({ done: true }) })) {
      const report = runChain(
        w.runtime,
        w.paths,
        { agent: providerAgent(w.deps), gate: () => "failed" },
        DEFAULT_POLICY.autonomy,
        CONTRACT,
        subcontracts(CONTRACT, []),
      );
      assert.equal(
        report.items.some((item) => item.status === "proven"),
        false,
      );
      assert.ok(w.calls.length > 0);
    }
  });
});
