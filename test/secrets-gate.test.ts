import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { GitResult } from "../src/core/runtime.js";
import { secretsGateStatus } from "../src/secrets/gate.js";
import { recordIncident } from "../src/secrets/incidents.js";
import { SAMPLES } from "./secret-samples.js";
import { fakeRuntime, gitMissing } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");

const worktreeDiff = [
  "diff --git a/run.sh b/run.sh",
  "--- a/run.sh",
  "+++ b/run.sh",
  "@@ -1,0 +2 @@",
  `+export TOKEN=${SAMPLES.githubPat}`,
].join("\n");

const git = (args: readonly string[]): GitResult => {
  if (args[0] === "diff") return { found: true, ok: true, stdout: worktreeDiff };
  if (args[0] === "ls-files") return { found: true, ok: true, stdout: "notes.txt\u0000" };
  return gitMissing;
};

describe("secrets status for the Stop gate", () => {
  it("sees a secret written by Bash, an untracked file and an incident opened during the task", () => {
    const runtime = fakeRuntime({ git, files: { [`${ROOT}/notes.txt`]: `key ${SAMPLES.gcp}\n` } });
    recordIncident(
      runtime,
      ROOT,
      { rule: "jwt", fingerprint: "00", where: "prompt:1", source: "prompt", state: "exposicao-local" },
      "finitemonkey",
    );
    const status = secretsGateStatus(runtime, ROOT, "2026-10-25T00:00:00.000Z");
    assert.ok(status.ok);
    assert.deepEqual(
      status.value.findings.map((item) => `${item.ruleId} ${item.file}:${String(item.line)}`),
      ["github-pat run.sh:2", "gcp-api-key notes.txt:1"],
    );
    assert.equal(status.value.openIncidents.length, 1);
    const later = secretsGateStatus(runtime, ROOT, "2026-10-26T00:00:00.000Z");
    assert.ok(later.ok);
    assert.equal(later.value.openIncidents.length, 0);
  });

  it("is an error, not a pass, when git cannot run", () => {
    assert.equal(secretsGateStatus(fakeRuntime(), ROOT, "").ok, false);
  });
});
