import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { boardOf } from "../src/fronts/board.js";
import { frontsSessionStart, recordFrontSession } from "../src/fronts/session.js";
import { EMPTY_STATE, type Front, parseFront, parseState, readFronts, serializeState } from "../src/fronts/state.js";
import { GIT_HANDLERS } from "../src/git/hooks/index.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const linked = (repo: Repo, branch: string): string => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `fm-front-${branch}-`)));
  rmSync(dir, { recursive: true, force: true });
  repo.git("worktree", "add", "-q", "-b", branch, dir);
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

const frontAt = (id: string, path: string, branch: string): Front => {
  const front = parseFront({ id, path, branch, status: "running" });
  assert.ok(front !== undefined);
  return front;
};

const fixture = () => {
  const repo = makeRepo({ "src/a.js": "1\n" });
  cleanups.push(() => {
    repo.cleanup();
  });
  const a = linked(repo, "front-a");
  const b = linked(repo, "front-b");
  repo.write(
    ".finitemonkey/fronts.yml",
    serializeState({ ...EMPTY_STATE, fronts: [frontAt("a", a, "front-a"), frontAt("b", b, "front-b")] }),
  );
  return { repo, a, b };
};

const sessions = (repo: Repo): readonly (string | undefined)[] => {
  const state = readFronts(repoRuntime(), repo.root);
  assert.ok(state.ok);
  return state.value.fronts.map((front) => front.sessionId);
};

describe("fronts session id", () => {
  it("a front started in its worktree records the session id at its first SessionStart", () => {
    const { repo, a } = fixture();
    const nested = join(a, "src");
    mkdirSync(nested, { recursive: true });
    assert.equal(recordFrontSession(repoRuntime(), toAbsolutePath(nested), "sess-1"), "a");
    assert.deepEqual(sessions(repo), ["sess-1", undefined]);
    assert.match(repo.read(".finitemonkey/fronts.yml"), /session_id: sess-1/);
  });

  it("a later session in the same worktree keeps the first id", () => {
    const { repo, a } = fixture();
    recordFrontSession(repoRuntime(), toAbsolutePath(a), "sess-1");
    assert.equal(recordFrontSession(repoRuntime(), toAbsolutePath(a), "sess-2"), undefined);
    assert.deepEqual(sessions(repo), ["sess-1", undefined]);
  });

  it("the main worktree and a malformed id record nothing", () => {
    const { repo, b } = fixture();
    assert.equal(recordFrontSession(repoRuntime(), repo.root, "sess-1"), undefined);
    assert.equal(recordFrontSession(repoRuntime(), toAbsolutePath(b), "bad id; rm -rf"), undefined);
    assert.deepEqual(sessions(repo), [undefined, undefined]);
  });

  it("the board carries the session id and the command that opens it", () => {
    const { repo, a } = fixture();
    recordFrontSession(repoRuntime(), toAbsolutePath(a), "sess-1");
    const rows = boardOf(repoRuntime(), repo.root).rows;
    assert.deepEqual(
      rows.map((row) => [row.branch, row.sessionId, row.resume]),
      [
        ["main", null, null],
        ["front-a", "sess-1", "claude --resume sess-1"],
        ["front-b", null, null],
      ],
    );
  });

  it("runs on SessionStart, and a fronts.yml without session ids reads and writes as before", () => {
    assert.ok(GIT_HANDLERS.SessionStart?.includes(frontsSessionStart));
    const text = serializeState({ ...EMPTY_STATE, fronts: [frontAt("a", "/w/a", "front-a")] });
    assert.doesNotMatch(text, /session_id/);
    const parsed = parseState(text);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.fronts[0]?.sessionId, undefined);
  });
});
