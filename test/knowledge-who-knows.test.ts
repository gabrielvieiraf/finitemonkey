import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";

import { nodeRuntime } from "../src/core/node-runtime.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { appendClaimEvent } from "../src/knowledge/claims.js";
import { fmPaths } from "../src/task/paths.js";
import { contextOf, fireHook } from "./guardian-support.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const OPT_IN = "guards:\n  knowledge-map: active\n";

const commitAt = (repo: Repo, message: string, iso: string): void => {
  spawnSync("git", ["add", "-A"], { cwd: repo.root });
  const result = spawnSync("git", ["commit", "-q", "-m", message], {
    cwd: repo.root,
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
  assert.equal(result.status, 0, String(result.stderr));
};

const setup = (policy: string): Repo => {
  const repo = makeRepo({ "README.md": "app\n" });
  repos.push(repo);
  const now = Date.now();
  const iso = (hoursAgo: number): string => new Date(now - hoursAgo * 3_600_000).toISOString();
  repo.write("src/billing/total.ts", "export function total(): number {\n  return 1;\n}\n");
  commitAt(repo, "billing by hand", iso(48));
  repo.write("src/auth/login.ts", "export function login(): boolean {\n  return true;\n}\n");
  commitAt(repo, "auth in a session", iso(5));
  repo.write("src/reports/sum.ts", "export const sum = 1;\n");
  repo.write(".finitemonkey/prompts.jsonl", `${JSON.stringify({ at: iso(5.2), session: "s0", text: "add login" })}\n`);
  repo.write(".finitemonkey/policy.yml", policy);
  return repo;
};

const watched = (): { readonly runtime: Runtime; readonly commands: string[] } => {
  const base = repoRuntime();
  const commands: string[] = [];
  return {
    commands,
    runtime: {
      ...base,
      exec: (request: ExecRequest) => {
        commands.push(request.command);
        return base.exec(request);
      },
    },
  };
};

const renewChanged = (repo: Repo, id: string, text: string, at: string): void => {
  const paths = fmPaths(repo.root);
  const runtime = nodeRuntime();
  const anchor = { path: "src/billing/total.ts", symbol: "total", mode: "symbol" as const };
  appendClaimEvent(runtime, paths, {
    event: "add",
    id,
    recordedAt: "2026-10-01T10:00:00.000Z",
    text,
    kind: "prose",
    anchors: [{ ...anchor, hash: "aaaa" }],
    origin: { source: "person", attributedTo: "person", derivedFrom: {} },
    because: [],
  });
  appendClaimEvent(runtime, paths, { event: "renew", id, recordedAt: at, anchors: [{ ...anchor, hash: "bbbb" }] });
};

describe("who knows what", () => {
  it("computes the map from history and claims with no model call", async () => {
    const repo = setup(OPT_IN);
    const { runtime, commands } = watched();
    const run = await cliJson(["knowledge", "map"], { cwd: repo.root, runtime });
    assert.equal(run.code, 0, run.stdout);
    const areas = field(run.body, "data", "areas");
    assert.ok(Array.isArray(areas));
    const holder = (area: string): unknown =>
      field(
        areas.find((item) => field(item, "area") === area),
        "holder",
      );
    assert.equal(holder("src/billing"), "person");
    assert.equal(holder("src/auth"), "agent");
    assert.equal(holder("src/reports"), "nobody");
    assert.ok(
      commands.every((command) => command === "git"),
      commands.join(","),
    );
  });

  it("asks at most one spaced question per session, and a skipped one is not asked again", async () => {
    const repo = setup(OPT_IN);
    await cliJson(["knowledge", "map"], { cwd: repo.root, runtime: repoRuntime() });
    renewChanged(repo, "c-1", "total sums the cart", "2026-10-02T10:00:00.000Z");
    renewChanged(repo, "c-2", "total ignores refunds", "2026-10-03T10:00:00.000Z");
    const first = contextOf(await fireHook(repo, "SessionStart", { source: "startup", session_id: "s1" }));
    assert.equal((first.match(/One optional question/g) ?? []).length, 1);
    const again = contextOf(await fireHook(repo, "SessionStart", { source: "resume", session_id: "s1" }));
    assert.equal(again, "");
    const next = contextOf(await fireHook(repo, "SessionStart", { source: "startup", session_id: "s2" }));
    assert.match(next, /One optional question/);
    assert.notEqual(next, first);
    const done = contextOf(await fireHook(repo, "SessionStart", { source: "startup", session_id: "s3" }));
    assert.equal(done, "");
  });

  it("does nothing unless the person opted in", async () => {
    const repo = setup("guards:\n  knowledge-map: shadow\n");
    const run = await cliJson(["knowledge", "map"], { cwd: repo.root, runtime: repoRuntime() });
    assert.notEqual(run.code, 0);
    renewChanged(repo, "c-1", "total sums the cart", "2026-10-02T10:00:00.000Z");
    const started = contextOf(await fireHook(repo, "SessionStart", { source: "startup", session_id: "s1" }));
    assert.equal(started, "");
  });
});
