import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { appendEvidence } from "../src/evidence/ledger.js";
import { EVIDENCE_SCHEMA, type EvidenceStatus, GATE_CHECK } from "../src/evidence/types.js";
import { createTranslator } from "../src/i18n/translate.js";
import { loopIndex } from "../src/statusline/loop.js";
import { segmentText } from "../src/statusline/render.js";
import { fmPaths } from "../src/task/paths.js";
import { fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath(join("/home", "ana", "app"));
const ACTIVE = { [join(ROOT, ".fm", "policy.yml")]: "guards:\n  statusline-loop: active\n" };

const gates = (files: Readonly<Record<string, string>>, statuses: readonly EvidenceStatus[]) => {
  const runtime = fakeRuntime({ files });
  const paths = fmPaths(ROOT);
  appendEvidence(
    runtime,
    paths.evidence("t1"),
    statuses.map((status, index) => ({
      schema: EVIDENCE_SCHEMA,
      task: "t1",
      check: GATE_CHECK,
      kind: "gate",
      status,
      treeHash: `tree-${String(index)}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      notes: [],
    })),
  );
  return { runtime, paths };
};

describe("statusline loop index", () => {
  it("counts the gate runs since the last green one when active", () => {
    const { runtime, paths } = gates(ACTIVE, ["failed", "passed", "failed", "failed"]);
    assert.equal(loopIndex(runtime, paths, "t1"), 2);
    const green = gates(ACTIVE, ["failed", "passed"]);
    assert.equal(loopIndex(green.runtime, green.paths, "t1"), undefined);
    assert.equal(loopIndex(runtime, paths, undefined), undefined);
  });

  it("stays hidden in shadow, the default", () => {
    const { runtime, paths } = gates({}, ["failed", "failed"]);
    assert.equal(loopIndex(runtime, paths, "t1"), undefined);
  });

  it("renders after the fronts and before the blueprint", () => {
    const text = segmentText(createTranslator("en"), {
      task: "t1",
      gate: "red",
      contextPercent: undefined,
      fronts: "2 fronts",
      loop: 3,
    });
    assert.match(text, /2 fronts · loop 3$/);
  });
});
