import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadCorpus } from "../scripts/evidence-corpus.js";
import { guardEvidence } from "../scripts/evidence-rates.js";
import { REMOTE_CORPUS, replayRemote } from "../scripts/evidence-remote.js";
import { readEvidence } from "../scripts/evidence-text.js";
import { runtime, tempRepo } from "./git-support.js";
import { ROOT } from "./support.js";

describe("remote evidence", () => {
  it("the remote corpus has at least 50 cases that should be held and 50 that should pass, and every one decides as labeled", async () => {
    const corpus = loadCorpus(join(ROOT, "bench", "corpus"));
    assert.ok(corpus.ok, corpus.ok ? "" : corpus.error);
    const cases = corpus.value[REMOTE_CORPUS] ?? [];
    const repo = tempRepo();
    try {
      const evidence = guardEvidence(REMOTE_CORPUS, await replayRemote(runtime, repo.root, cases));
      assert.ok(evidence.positives >= 50, `${String(evidence.positives)} positives`);
      assert.ok(evidence.negatives >= 50, `${String(evidence.negatives)} negatives`);
      assert.deepEqual(evidence.wrong, []);
    } finally {
      repo.dispose();
    }
  });

  it("the committed evidence file reports the remote corpus within the budget", () => {
    const evidence = readEvidence(ROOT);
    assert.ok(evidence !== undefined);
    const remote = evidence.guards.find((guard) => guard.guard === REMOTE_CORPUS);
    assert.ok(remote !== undefined, "bench/evidence.json has no remote entry");
    assert.ok(remote.positives >= evidence.budget.minPositives);
    assert.ok(remote.negatives >= evidence.budget.minNegatives);
    assert.ok(remote.fpr <= evidence.budget.fprWarn);
  });
});
