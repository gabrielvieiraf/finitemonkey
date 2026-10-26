import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { toPosixPath } from "../src/core/posix-path.js";
import { commitMessageProblems } from "../src/githooks/commit-msg.js";
import { parsePushUpdates, updatesFromEnv } from "../src/githooks/pre-push.js";
import { git, runtime as nodeRt, tempDir, write } from "./git-support.js";
import { SAMPLES } from "./secret-samples.js";
import { BUNDLE, cli, cliJson, found } from "./support.js";

const runtime = { ...nodeRt, probe: () => found("2.1.300 (Claude Code)"), selfPath: BUNDLE };
const BIN = toPosixPath(BUNDLE);
const HOOKS = ["pre-commit", "commit-msg", "pre-push"] as const;

interface Attempt {
  readonly status: number | null;
  readonly output: string;
}

const attempt = (cwd: string, ...args: readonly string[]): Attempt => {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

interface Sandbox {
  readonly root: string;
  readonly repo: string;
}

const sandbox = async (): Promise<Sandbox> => {
  const root = tempDir("fm-hooks-");
  const repo = join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "main", "remote.git");
  git(root, "init", "-q", "-b", "main", "repo");
  for (const [key, value] of [
    ["user.name", "Ana"],
    ["user.email", "ana@example.com"],
    ["core.autocrlf", "false"],
    ["core.hooksPath", ".husky/_"],
  ] as const)
    git(repo, "config", key, value);
  git(repo, "remote", "add", "origin", "../remote.git");
  for (const hook of HOOKS) write(repo, `.husky/_/${hook}`, `#!/bin/sh\nexec sh "$(dirname "$0")/../${hook}" "$@"\n`);
  const init = await cliJson(["init", "--yes", "--bin", BIN], { cwd: toAbsolutePath(repo), runtime, env: {} });
  assert.equal(init.code, 0, init.stdout);
  for (const name of readdirSync(join(repo, ".husky", "_"))) chmodSync(join(repo, ".husky", "_", name), 0o755);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: install finite monkey");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "switch", "-q", "-c", "work");
  return { root, repo };
};

let box: Sandbox = { root: "", repo: "" };

before(async () => {
  box = await sandbox();
});

after(() => {
  rmSync(box.root, { recursive: true, force: true });
});

describe("init adds steps to the husky hooks", () => {
  it("each hook file has one managed block calling finitemonkey", () => {
    const hooks = HOOKS.map((name) => readFileSync(join(box.repo, ".husky", name), "utf8"));
    assert.match(hooks[0] ?? "", /secrets scan --staged/);
    assert.match(hooks[1] ?? "", /commit-msg "\$1"/);
    assert.match(hooks[2] ?? "", /push check "\$1"/);
  });
});

describe("pre-commit hook", () => {
  it("blocks a staged secret and lets a clean commit through", () => {
    write(box.repo, "src/config.ts", `export const token = "${SAMPLES.githubPat}";\n`);
    git(box.repo, "add", "src/config.ts");
    const blocked = attempt(box.repo, "commit", "-q", "-m", "feat: add config");
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.output, /github-pat src\/config\.ts:1/);
    assert.ok(!blocked.output.includes(SAMPLES.githubPat));
    write(box.repo, "src/config.ts", "export const token = process.env.TOKEN;\n");
    git(box.repo, "add", "src/config.ts");
    assert.equal(attempt(box.repo, "commit", "-q", "-m", "feat: add config").status, 0);
  });
});

describe("commit-msg hook", () => {
  it("blocks a message outside Conventional Commits and one with AI attribution", () => {
    write(box.repo, "a.txt", "a\n");
    git(box.repo, "add", "a.txt");
    const header = attempt(box.repo, "commit", "-q", "-m", "added a file");
    assert.notEqual(header.status, 0);
    assert.match(header.output, /FAIL commit-messages: header\. Fix: /);
    const credit = attempt(
      box.repo,
      "commit",
      "-q",
      "-m",
      "feat: a",
      "-m",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    );
    assert.notEqual(credit.status, 0);
    assert.match(credit.output, /attribution/);
    assert.equal(attempt(box.repo, "commit", "-q", "-m", "feat: add a file").status, 0);
  });
});

describe("pre-push hook", () => {
  it("passes a clean branch", () => {
    const pushed = attempt(box.repo, "push", "-q", "origin", "work");
    assert.equal(pushed.status, 0, pushed.output);
  });

  it("blocks a secret that skipped the local hooks", () => {
    git(box.repo, "switch", "-q", "-c", "leak");
    write(box.repo, "b.ts", `const key = "${SAMPLES.stripeLive}";\n`);
    git(box.repo, "add", "b.ts");
    git(box.repo, "commit", "-q", "--no-verify", "-m", "feat: b");
    const pushed = attempt(box.repo, "push", "-q", "origin", "leak");
    assert.notEqual(pushed.status, 0);
    assert.match(pushed.output, /FAIL secrets: stripe-access-token at b\.ts:1/);
    assert.ok(!pushed.output.includes(SAMPLES.stripeLive));
  });

  it("blocks a force push that rewrites a protected branch", () => {
    git(box.repo, "switch", "-q", "main");
    git(box.repo, "commit", "-q", "--amend", "--no-verify", "-m", "chore: install finite monkey again");
    const forced = attempt(box.repo, "push", "-q", "--force", "origin", "main");
    assert.notEqual(forced.status, 0);
    assert.match(forced.output, /FAIL protected: rewrites protected branch main/);
  });
});

describe("finitemonkey ci gate", () => {
  it("prints one line per failing check, each with its fix", async () => {
    git(box.repo, "switch", "-q", "-c", "ci-bad", "origin/main");
    write(box.repo, "c.ts", `const t = "${SAMPLES.npmToken}";\n`);
    git(box.repo, "add", "c.ts");
    git(box.repo, "commit", "-q", "--no-verify", "-m", "wip");
    const run = await cli(["ci", "gate", "--base", "origin/main"], { cwd: toAbsolutePath(box.repo), runtime, env: {} });
    assert.equal(run.code, 1);
    const lines = run.stdout.trim().split("\n");
    assert.deepEqual(
      lines.map((line) => line.split(":")[0]),
      ["FAIL secrets", "FAIL commit-messages"],
    );
    for (const line of lines) assert.match(line, /\. Fix: \S/);
    assert.ok(!run.stdout.includes(SAMPLES.npmToken));
  });

  it("passes a clean branch", async () => {
    git(box.repo, "switch", "-q", "-c", "ci-good", "origin/main");
    write(box.repo, "d.txt", "d\n");
    git(box.repo, "add", "d.txt");
    git(box.repo, "commit", "-q", "--no-verify", "-m", "docs: d");
    const run = await cli(["ci", "gate"], { cwd: toAbsolutePath(box.repo), runtime, env: { GITHUB_BASE_REF: "main" } });
    assert.equal(run.code, 0, run.stdout);
  });
});

describe("commit message rules", () => {
  const cases = [
    ["feat(init): detect husky", []],
    ["fix!: drop node 18", []],
    ["Merge branch 'next' into feat/x", []],
    ["fixup! feat: x", []],
    ["update stuff", ["header"]],
    [`feat: ${"x".repeat(100)}`, ["header_length"]],
    ["feat: x\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>", ["attribution"]],
    ["feat: x\n\nCo-Authored-By: Ana <ana@example.com>", []],
    ["feat: x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)", ["attribution"]],
    ["feat: x\n# Co-Authored-By: Claude <noreply@anthropic.com>", []],
  ] as const;
  for (const [message, expected] of cases) {
    it(JSON.stringify(message.slice(0, 40)), () => {
      assert.deepEqual(commitMessageProblems(message), expected);
    });
  }

  it("reads pre-push updates from stdin and from the pre-commit framework variables", () => {
    const sha = "a".repeat(40);
    const zero = "0".repeat(40);
    assert.deepEqual(parsePushUpdates(`refs/heads/x ${sha} refs/heads/x ${zero}\n`), [
      { localRef: "refs/heads/x", localSha: sha, remoteRef: "refs/heads/x", remoteSha: zero },
    ]);
    assert.deepEqual(updatesFromEnv({ PRE_COMMIT_FROM_REF: zero, PRE_COMMIT_TO_REF: sha }), [
      { localRef: sha, localSha: sha, remoteRef: "", remoteSha: zero },
    ]);
    assert.deepEqual(updatesFromEnv({}), []);
  });
});
