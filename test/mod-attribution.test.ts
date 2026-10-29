import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { attributionOf } from "../src/bridge/attribution.js";
import { writeGateStatus } from "../src/gate/hooks/status.js";
import { STARTS_IN_SHADOW } from "../src/policy/policy.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const project = (files: Readonly<Record<string, string>> = {}): Repo => {
  const repo = makeRepo({ "src/a.js": "export const a = 1;\n", ...files });
  repos.push(repo);
  return repo;
};

describe("attribution for the mod", () => {
  it("forbids AI credit by default, through the no-attribution rule", () => {
    const repo = project();
    assert.deepEqual(attributionOf(repoRuntime(), fmPaths(repo.root)), { forbid: true, trailer: null });
  });

  it("keeps the credit when the project turns the default off", () => {
    const repo = project({ ".finitemonkey/config.yml": "defaults:\n  no-attribution: off\n" });
    assert.equal(attributionOf(repoRuntime(), fmPaths(repo.root)).forbid, false);
  });

  it("the trailer starts in shadow and, turned on, names the last gate verdict and tree", () => {
    assert.ok(STARTS_IN_SHADOW.has("attribution-trailer"));
    const repo = project({ ".finitemonkey/policy.yml": "guards:\n  attribution-trailer: active\n" });
    const paths = fmPaths(repo.root);
    assert.equal(attributionOf(repoRuntime(), paths).trailer, null);
    writeGateStatus(repoRuntime(), paths, { status: "passed", task: "t1", detail: "", tree: "9a1e77" });
    assert.equal(attributionOf(repoRuntime(), paths).trailer, "Verified-by: finitemonkey passed tree:9a1e77");
  });
});
