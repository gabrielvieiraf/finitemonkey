import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { sessionStart } from "../src/gate/hooks/session.js";
import { mirrorDirs, mirrorStore, restoreStore } from "../src/task/mirror.js";
import { hook, runtime, tempRepo, write } from "./git-support.js";

const GRANTS = '{"grants":[],"approvals":[{"task":"t1","check":"manual-1","reason":"looked at it"}]}\n';
const INCIDENT = '{"schemaVersion":1,"id":"inc-000000000001","state":"aberto"}\n';

const seed = (root: string): void => {
  write(root, ".finitemonkey/allow/grants.json", GRANTS);
  write(root, ".finitemonkey/incidents/inc-000000000001.json", INCIDENT);
};

describe("store mirror", () => {
  it("deleting .finitemonkey/ in a fixture restores approvals and incidents from the mirror and records it", async () => {
    const repo = tempRepo();
    try {
      seed(repo.root);
      assert.equal(mirrorStore(runtime, repo.root), 2);
      rmSync(join(repo.root, ".finitemonkey"), { recursive: true, force: true });
      const started = await hook(sessionStart, "SessionStart", repo.root, { source: "startup" });
      assert.equal(readFileSync(join(repo.root, ".finitemonkey/allow/grants.json"), "utf8"), GRANTS);
      assert.equal(readFileSync(join(repo.root, ".finitemonkey/incidents/inc-000000000001.json"), "utf8"), INCIDENT);
      assert.match(readFileSync(join(repo.root, ".finitemonkey/log.jsonl"), "utf8"), /"event":"store_restored"/);
      assert.match(JSON.stringify(started.output ?? {}), /restored 2 files/);
    } finally {
      repo.dispose();
    }
  });

  it("restores from the copy in the home directory when the one inside .git is gone too", () => {
    const repo = tempRepo();
    try {
      seed(repo.root);
      mirrorStore(runtime, repo.root);
      const [inGit, inHome] = mirrorDirs(runtime, repo.root);
      assert.ok(inGit !== undefined && inHome !== undefined);
      rmSync(inGit, { recursive: true, force: true });
      rmSync(join(repo.root, ".finitemonkey"), { recursive: true, force: true });
      assert.deepEqual(restoreStore(runtime, repo.root), { from: inHome, files: 2 });
    } finally {
      repo.dispose();
    }
  });

  it("does not restore from a mirror whose index was edited, nor a file whose content changed", () => {
    const repo = tempRepo();
    try {
      seed(repo.root);
      mirrorStore(runtime, repo.root);
      const dirs = mirrorDirs(runtime, repo.root);
      for (const dir of dirs) writeFileSync(join(dir, "allow/grants.json"), '{"grants":[{"guard":"git"}]}\n');
      rmSync(join(repo.root, ".finitemonkey"), { recursive: true, force: true });
      assert.deepEqual(restoreStore(runtime, repo.root)?.files, 1);
      assert.ok(!existsSync(join(repo.root, ".finitemonkey/allow/grants.json")));
      rmSync(join(repo.root, ".finitemonkey"), { recursive: true, force: true });
      for (const dir of dirs) {
        const index = join(dir, "index.json");
        writeFileSync(index, readFileSync(index, "utf8").replace("inc-000000000001", "inc-000000000002"));
      }
      assert.equal(restoreStore(runtime, repo.root), undefined);
    } finally {
      repo.dispose();
    }
  });

  it("leaves a store that still has its mirror marker alone", () => {
    const repo = tempRepo();
    try {
      seed(repo.root);
      mirrorStore(runtime, repo.root);
      rmSync(join(repo.root, ".finitemonkey/incidents"), { recursive: true, force: true });
      assert.equal(restoreStore(runtime, repo.root), undefined);
    } finally {
      repo.dispose();
    }
  });
});
