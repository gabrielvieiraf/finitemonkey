import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";

import type { AbsolutePath } from "../src/core/brand.js";
import type { JsonObject } from "../src/core/parsed.js";
import { prPreToolUse } from "../src/pr/hooks.js";
import { bash, git, hook, initRepo, tempDir, write } from "./git-support.js";
import { BUNDLE, field, parseBody } from "./support.js";

interface Box {
  readonly root: AbsolutePath;
  readonly remote: AbsolutePath;
  readonly bin: AbsolutePath;
  readonly log: string;
  readonly dispose: () => void;
}

const FAKE_GH = `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const at = args.indexOf("--body-file");
const body = at < 0 ? "" : readFileSync(args[at + 1], "utf8");
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, body }) + "\\n");
console.log("https://github.com/acme/app/pull/7");
`;

const sandbox = (): Box => {
  const remote = tempDir("fm-pr-remote-");
  git(remote, "init", "-q", "--bare", "-b", "main");
  const root = tempDir("fm-pr-");
  const bin = tempDir("fm-pr-bin-");
  initRepo(root);
  write(root, "src/app.ts", "export const app = 1;\n");
  write(root, "contract.yml", "scope:\n  paths: [src/**]\n  shared:\n    append: [src/routes.ts]\n");
  write(root, "src/routes.ts", 'export const routes = [\n  "/home",\n];\n');
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "-u", "origin", "main");
  git(root, "switch", "-q", "-c", "feat/12-checkout");
  writeFileSync(join(bin, "gh.mjs"), FAKE_GH);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec node "${join(bin, "gh.mjs").replace(/\\/g, "/")}" "$@"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(bin, "gh.cmd"), `@node "%~dp0gh.mjs" %*\r\n`);
  const log = join(bin, "gh.log");
  return {
    root,
    remote,
    bin,
    log,
    dispose: () => {
      for (const path of [root, remote, bin]) rmSync(path, { recursive: true, force: true });
    },
  };
};

const fm = (box: Box, args: readonly string[]) => fmIn(box, box.root, args);

const fmIn = (box: Box, cwd: string, args: readonly string[]) => {
  const result = spawnSync(process.execPath, [BUNDLE, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: `${box.bin}${delimiter}${process.env["PATH"] ?? ""}`,
      SystemRoot: process.env["SystemRoot"],
      HOME: box.bin,
      USERPROFILE: box.bin,
      FAKE_GH_LOG: box.log,
    },
    timeout: 60000,
  });
  return { code: result.status, body: parseBody(result.stdout) };
};

const ghCalls = (box: Box): readonly JsonObject[] =>
  existsSync(box.log)
    ? readFileSync(box.log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => parseBody(line))
    : [];

const commit = (box: Box, path: string, content: string): void => {
  write(box.root, path, content);
  git(box.root, "add", "-A");
  git(box.root, "commit", "-q", "-m", `feat: ${path}`);
};

describe("pr open", () => {
  it("files outside the scope stop pr open without a person, and the accept flag blocks in -p mode", async () => {
    const box = sandbox();
    try {
      commit(box, "src/app.ts", "export const app = 2;\n");
      commit(box, "docs/notes.md", "notes\n");
      const run = fm(box, ["pr", "open", "--task", "contract.yml"]);
      assert.equal(run.code, 4);
      assert.equal(field(run.body, "error", "code"), "pr_outside_scope");
      assert.match(String(field(run.body, "error", "message")), /docs\/notes\.md/);
      assert.equal(ghCalls(box).length, 0);
      const command = 'finitemonkey pr open --task contract.yml --accept-outside "notes belong here"';
      const headless = await hook(prPreToolUse, "PreToolUse", box.root, {
        permission_mode: "dontAsk",
        ...bash(command),
      });
      assert.equal(headless.kind, "block");
      const interactive = await hook(prPreToolUse, "PreToolUse", box.root, {
        permission_mode: "default",
        ...bash(command),
      });
      assert.match(JSON.stringify(interactive), /"permissionDecision":"ask"/);
    } finally {
      box.dispose();
    }
  });

  it("a predicted conflict with the fresh base prevents opening the pull request", () => {
    const box = sandbox();
    const other = tempDir("fm-pr-other-");
    try {
      commit(box, "src/app.ts", "export const app = 2;\n");
      git(other, "clone", "-q", box.remote, ".");
      initRepo(other);
      git(other, "switch", "-q", "main");
      write(other, "src/app.ts", "export const app = 3;\n");
      git(other, "commit", "-q", "-am", "fix: app 3");
      git(other, "push", "-q", "origin", "main");
      const run = fm(box, ["pr", "open", "--task", "contract.yml"]);
      assert.equal(run.code, 1);
      assert.equal(field(run.body, "error", "code"), "pr_conflict");
      assert.match(String(field(run.body, "error", "message")), /src\/app\.ts/);
      assert.equal(ghCalls(box).length, 0);
    } finally {
      rmSync(other, { recursive: true, force: true });
      box.dispose();
    }
  });

  it("the body carries the scope table, the checklist and the snapshot refs", () => {
    const box = sandbox();
    try {
      commit(box, "src/app.ts", "export const app = 2;\n");
      commit(box, "src/routes.ts", 'export const routes = [\n  "/home",\n  "/pay",\n];\n');
      assert.equal(fm(box, ["snapshot", "--message", "before pr"]).code, 0);
      const run = fm(box, ["pr", "open", "--task", "contract.yml", "--title", "feat: checkout"]);
      assert.equal(run.code, 0, JSON.stringify(run.body));
      assert.equal(field(run.body, "data", "url"), "https://github.com/acme/app/pull/7");
      const [call] = ghCalls(box);
      assert.ok(call);
      const body = String(call["body"]);
      assert.match(body, /\| Declared scope \| Outside the scope \|/);
      assert.match(body, /\| src\/\*\*, src\/routes\.ts \| none \|/);
      assert.match(body, /- \[x\] Append-only registry src\/routes\.ts: only additions, checked/);
      assert.match(body, /refs\/finitemonkey\/backup\/[^`]*before-pr/);
      assert.deepEqual((call["args"] as readonly string[]).slice(0, 6), [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        "feat/12-checkout",
      ]);
      assert.match(git(box.remote, "branch", "--list", "feat/12-checkout"), /feat\/12-checkout/);
    } finally {
      box.dispose();
    }
  });
});

describe("pr open: owners and stacked branches", () => {
  it("a pull request after a C0 conflict requests every listed owner as reviewer", () => {
    const box = sandbox();
    try {
      commit(box, "src/app.ts", "export const app = 2;\n");
      const merges = join(box.root, ".git", "finitemonkey", "merges");
      const report = {
        schema: "finitemonkey/merge-report@1",
        integration: { branch: "feat/12-checkout", path: box.root, id: "integration" },
        files: [
          { path: "src/app.ts", class: "C0", owners: ["@ana", "@acme/payments", "ops@acme.example"] },
          { path: "src/routes.ts", class: "C1", owners: [] },
        ],
      };
      write(merges, "20261101T000000Z.json", JSON.stringify(report));
      const run = fm(box, ["pr", "open", "--task", "contract.yml", "--title", "feat: checkout"]);
      assert.equal(run.code, 0, JSON.stringify(run.body));
      const args = (ghCalls(box)[0]?.["args"] ?? []) as readonly string[];
      const reviewers = args.filter((_, index) => args[index - 1] === "--reviewer");
      assert.deepEqual(reviewers, ["ana", "acme/payments"]);
    } finally {
      box.dispose();
    }
  });

  it("a child branch opens against its parent and is rebased after the parent is merged", () => {
    const box = sandbox();
    try {
      git(box.root, "switch", "-q", "-c", "feat/10-cart", "main");
      commit(box, "src/cart.ts", "export const cart = 1;\n");
      const created = fm(box, [
        "wt",
        "new",
        "child",
        "--purpose",
        "pay",
        "--base",
        "feat/10-cart",
        "--parent",
        "feat/10-cart",
      ]);
      assert.equal(created.code, 0, JSON.stringify(created.body));
      const child = String(field(created.body, "data", "worktree", "path"));
      assert.ok(existsSync(join(child, "src", "app.ts")), child);
      write(child, "src/pay.ts", "export const pay = 1;\n");
      git(child, "add", "-A");
      git(child, "commit", "-q", "-m", "feat: pay");
      const first = fmIn(box, child, ["pr", "open", "--task", "contract.yml", "--title", "feat: pay"]);
      assert.equal(first.code, 0, JSON.stringify(first.body));
      assert.equal(field(first.body, "data", "base"), "feat/10-cart");
      git(box.root, "switch", "-q", "main");
      git(box.root, "merge", "-q", "--squash", "feat/10-cart");
      git(box.root, "commit", "-q", "-m", "feat: cart (#10)");
      git(box.root, "push", "-q", "origin", "main");
      const second = fmIn(box, child, ["pr", "open", "--task", "contract.yml", "--title", "feat: pay"]);
      assert.equal(second.code, 0, JSON.stringify(second.body));
      assert.equal(field(second.body, "data", "base"), "main");
      const bases = ghCalls(box).map((call) => (call["args"] as readonly string[])[3]);
      assert.deepEqual(bases, ["feat/10-cart", "main"]);
      assert.equal(git(child, "rev-list", "--count", "main..HEAD"), "1");
      assert.equal(git(child, "rev-parse", "HEAD^"), git(box.root, "rev-parse", "main"));
    } finally {
      spawnSync("git", ["worktree", "unlock", join(box.root, ".claude", "worktrees", "child")], { cwd: box.root });
      box.dispose();
    }
  });
});

describe("pr hooks", () => {
  const decide = async (root: AbsolutePath, payload: JsonObject) => hook(prPreToolUse, "PreToolUse", root, payload);

  it("redirects gh pr create and the MCP tool, and lets only gh pr merge --auto through", async () => {
    const box = sandbox();
    try {
      assert.equal((await decide(box.root, bash("gh pr create --title x --body y"))).kind, "block");
      assert.equal(
        (await decide(box.root, { tool_name: "mcp__github__create_pull_request", tool_input: {} })).kind,
        "block",
      );
      assert.equal((await decide(box.root, bash("gh pr merge 7 --squash"))).kind, "block");
      assert.equal((await decide(box.root, bash("gh pr merge 7 --auto --squash"))).kind, "allow");
      assert.equal((await decide(box.root, bash("gh pr view 7"))).kind, "allow");
    } finally {
      box.dispose();
    }
  });

  it("branch names are a block by default and a warning when branch-names is off", async () => {
    const box = sandbox();
    try {
      write(box.root, ".fm/config.yml", "defaults:\n  branch-names: off\n");
      const loose = await decide(box.root, bash("git switch -c my-stuff"));
      assert.equal(loose.kind, "allow");
      assert.match(JSON.stringify(loose), /does not follow/);
      assert.equal((await decide(box.root, bash("git switch -c feat/12-pix-checkout"))).kind, "allow");
      write(box.root, ".fm/config.yml", "schemaVersion: 1\n");
      assert.equal((await decide(box.root, bash("git checkout -b my-stuff"))).kind, "block");
      assert.equal((await decide(box.root, bash("git worktree add ../x -b tmp"))).kind, "block");
      assert.equal((await decide(box.root, bash("git branch -d my-stuff"))).kind, "allow");
    } finally {
      box.dispose();
    }
  });
});
