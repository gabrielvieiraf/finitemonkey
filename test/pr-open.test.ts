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

const fm = (box: Box, args: readonly string[]) => {
  const result = spawnSync(process.execPath, [BUNDLE, ...args, "--json"], {
    cwd: box.root,
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

  it("branch names are a warning in the neutral preset and a block in the strict one", async () => {
    const box = sandbox();
    try {
      const loose = await decide(box.root, bash("git switch -c my-stuff"));
      assert.equal(loose.kind, "allow");
      assert.match(JSON.stringify(loose), /does not follow/);
      assert.equal((await decide(box.root, bash("git switch -c feat/12-pix-checkout"))).kind, "allow");
      write(box.root, ".finitemonkey/config.yml", "preset: gabriel\n");
      assert.equal((await decide(box.root, bash("git checkout -b my-stuff"))).kind, "block");
      assert.equal((await decide(box.root, bash("git worktree add ../x -b tmp"))).kind, "block");
      assert.equal((await decide(box.root, bash("git branch -d my-stuff"))).kind, "allow");
    } finally {
      box.dispose();
    }
  });
});
