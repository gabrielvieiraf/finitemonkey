import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { toPosixPath } from "../src/core/posix-path.js";
import { selfGuard } from "../src/guards/self/hook.js";
import { selfTarget } from "../src/guards/self/protected.js";
import { adoptWorktrees, mayHaveLinkedWorktrees } from "../src/wt/adopt.js";
import { wtPostToolUse, wtSessionStart } from "../src/wt/hooks.js";
import { defaultPlace, placeProblems } from "../src/wt/place.js";
import { allocatePorts } from "../src/wt/ports.js";
import { commonDirOf, readRegistry, registryPath } from "../src/wt/store.js";
import { bash, edit, git, hook, runtime, tempRepo, write } from "./git-support.js";
import { BUNDLE, fakeRuntime, field, parseBody, ROOT } from "./support.js";

const registryOf = (root: AbsolutePath) => {
  const common = commonDirOf(runtime, root);
  assert.ok(common);
  const read = readRegistry(runtime, common);
  assert.ok(read.ok, read.ok ? "" : read.error);
  return { common, entries: read.value.worktrees };
};

const fm = (cwd: string, args: readonly string[]) => {
  const result = spawnSync(process.execPath, [BUNDLE, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], HOME: cwd, USERPROFILE: cwd },
    timeout: 30000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("worktree registry: cheap SessionStart", () => {
  const root = toAbsolutePath("/repo");
  const sub = toAbsolutePath("/repo/src/app");

  it("skips git entirely in a repository without linked worktrees", () => {
    const calls: string[][] = [];
    const fake = fakeRuntime({
      files: { [toAbsolutePath("/repo/.git/HEAD")]: "ref: refs/heads/main\n" },
      git: (args) => {
        calls.push([...args]);
        return { found: true, ok: false, stdout: "" };
      },
    });
    assert.equal(mayHaveLinkedWorktrees(fake, sub), false);
    const adopted = adoptWorktrees(fake, sub);
    assert.ok(adopted.ok);
    assert.deepEqual(adopted.value, []);
    assert.deepEqual(calls, []);
  });

  it("still looks when .git/worktrees exists or when inside a linked worktree", () => {
    const withLinked = fakeRuntime({ files: { [toAbsolutePath("/repo/.git/worktrees/x/HEAD")]: "x\n" } });
    assert.equal(mayHaveLinkedWorktrees(withLinked, root), true);
    const insideLinked = fakeRuntime({
      files: { [toAbsolutePath("/repo/.git")]: "gitdir: /main/.git/worktrees/repo\n" },
    });
    assert.equal(mayHaveLinkedWorktrees(insideLinked, root), true);
  });
});

describe("worktree registry: adoption", () => {
  it("adopts worktrees created elsewhere and never deletes or prunes anything", async () => {
    const repo = tempRepo({ "a.txt": "one\n" });
    const dirty = `${repo.root}-dirty`;
    const gone = `${repo.root}-gone`;
    try {
      git(repo.root, "worktree", "add", "-q", dirty, "-b", "feat/dirty");
      write(dirty, "work.txt", "not committed\n");
      git(repo.root, "worktree", "add", "-q", gone, "-b", "feat/gone");
      rmSync(gone, { recursive: true, force: true });
      const listedBefore = git(repo.root, "worktree", "list", "--porcelain");
      await hook(wtSessionStart, "SessionStart", repo.root);
      await hook(wtSessionStart, "SessionStart", repo.root);
      const { entries } = registryOf(repo.root);
      assert.deepEqual(entries.map((entry) => entry.branch).sort(), ["feat/dirty", "feat/gone"]);
      assert.ok(entries.every((entry) => entry.status === "adopted"));
      assert.equal(readFileSync(join(dirty, "work.txt"), "utf8"), "not committed\n");
      assert.equal(git(repo.root, "worktree", "list", "--porcelain"), listedBefore);
      assert.match(git(repo.root, "branch", "--list", "feat/gone"), /feat\/gone/);
    } finally {
      repo.dispose();
      rmSync(dirty, { recursive: true, force: true });
    }
  });

  it("adopts a worktree added through Bash with the subagent as owner", async () => {
    const repo = tempRepo();
    const tree = `${repo.root}-sub`;
    try {
      git(repo.root, "worktree", "add", "-q", tree, "-b", "feat/sub");
      await hook(wtPostToolUse, "PostToolUse", repo.root, {
        agent_id: "agent-7",
        ...bash(`git worktree add ${toPosixPath(tree)} -b feat/sub`),
      });
      const entry = registryOf(repo.root).entries[0];
      assert.ok(entry);
      assert.equal(entry.owner.kind, "subagent");
      assert.equal(entry.owner.agentId, "agent-7");
      assert.equal(entry.branch, "feat/sub");
    } finally {
      repo.dispose();
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it("wt adopt reports every worktree and registers the missing ones", () => {
    const repo = tempRepo();
    const tree = `${repo.root}-ide`;
    try {
      git(repo.root, "worktree", "add", "-q", tree, "-b", "feat/ide");
      const run = fm(repo.root, ["wt", "adopt", "--json"]);
      assert.equal(run.code, 0, run.stderr);
      const rows = field(parseBody(run.stdout), "data", "worktrees");
      assert.ok(Array.isArray(rows));
      assert.equal(rows.length, 2);
      assert.equal(registryOf(repo.root).entries.length, 1);
      assert.ok(existsSync(tree));
    } finally {
      repo.dispose();
      rmSync(tree, { recursive: true, force: true });
    }
  });
});

const writer = (common: string, prefix: string, count: number): Promise<number> => {
  const store = pathToFileURL(join(ROOT, "src", "wt", "store.ts")).href;
  const runtimeUrl = pathToFileURL(join(ROOT, "src", "core", "node-runtime.ts")).href;
  const script = `
    const { updateRegistry, upsertEntry } = await import(${JSON.stringify(store)});
    const { nodeRuntime } = await import(${JSON.stringify(runtimeUrl)});
    const runtime = nodeRuntime();
    for (let i = 0; i < ${String(count)}; i += 1) {
      const id = ${JSON.stringify(prefix)} + "-" + i;
      const entry = { id, path: "/w/" + id, branch: id, baseRef: null, baseSha: null, target: null,
        owner: { kind: "session", agentId: null, sessionId: ${JSON.stringify(prefix)} }, purpose: "p", contract: null,
        parent: null, ports: null, pids: [], createdAt: "t", activityAt: "t", status: "active", pr: null, archive: null };
      const done = updateRegistry(runtime, ${JSON.stringify(common)}, id, (registry) => ({ ok: true, value: { registry: upsertEntry(registry, entry), result: true } }));
      if (!done.ok) { console.error(done.error); process.exit(1); }
    }`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
};

describe("worktree registry: concurrent writers", () => {
  it("six sessions writing at once keep every entry and a parseable file", async () => {
    const repo = tempRepo();
    try {
      const { common } = registryOf(repo.root);
      const codes = await Promise.all(["s1", "s2", "s3", "s4", "s5", "s6"].map((name) => writer(common, name, 5)));
      assert.deepEqual(codes, [0, 0, 0, 0, 0, 0]);
      const { entries } = registryOf(repo.root);
      assert.equal(entries.length, 30);
      assert.equal(new Set(entries.map((entry) => entry.id)).size, 30);
      assert.ok(!existsSync(`${registryPath(common)}.lock`));
    } finally {
      repo.dispose();
    }
  });
});

describe("worktree registry: self guard", () => {
  const guarded = async (root: AbsolutePath, payload: Readonly<Record<string, unknown>>) =>
    (await hook(selfGuard, "PreToolUse", root, payload)).kind;

  it("blocks Edit, Write and shell writes to the registry from any worktree", async () => {
    const repo = tempRepo();
    const tree = `${repo.root}-wt`;
    try {
      git(repo.root, "worktree", "add", "-q", tree, "-b", "feat/x");
      const file = join(repo.root, ".git", "finitemonkey", "worktrees.yml");
      assert.equal(await guarded(repo.root, edit(file)), "block");
      assert.equal(await guarded(toAbsolutePath(tree), edit(file)), "block");
      assert.equal(await guarded(repo.root, { tool_name: "Write", tool_input: { file_path: file } }), "block");
      assert.equal(await guarded(repo.root, bash("echo '- id: x' >> .git/finitemonkey/worktrees.yml")), "block");
      assert.equal(await guarded(repo.root, bash("cat .git/finitemonkey/worktrees.yml")), "allow");
      assert.equal(selfTarget(repo.root, "src/finitemonkey/index.ts"), undefined);
    } finally {
      repo.dispose();
      rmSync(tree, { recursive: true, force: true });
    }
  });
});

describe("worktree registry: wt new", () => {
  it("creates the worktree, branch, locked state, port range and entry", () => {
    const repo = tempRepo();
    try {
      const first = fm(repo.root, ["wt", "new", "F1-checkout", "--purpose", "checkout with Pix", "--json"]);
      assert.equal(first.code, 0, first.stderr);
      const second = fm(repo.root, ["wt", "new", "F2-invites", "--purpose", "invites", "--json"]);
      assert.equal(second.code, 0, second.stderr);
      const { entries, common } = registryOf(repo.root);
      const one = entries[0];
      const two = entries[1];
      assert.ok(one && two);
      assert.equal(one.ports?.from, 5174);
      assert.equal(two.ports?.from, 5184);
      assert.equal(one.branch, "agent/F1-checkout");
      assert.equal(one.status, "active");
      assert.match(toPosixPath(one.path), /\.claude\/worktrees\/F1-checkout$/);
      assert.match(git(repo.root, "worktree", "list", "--porcelain"), /locked finitemonkey:F1-checkout active/);
      assert.match(readFileSync(join(common, "info", "exclude"), "utf8"), /\/\.claude\/worktrees\//);
      assert.equal(git(repo.root, "status", "--porcelain"), "");
      const again = fm(repo.root, ["wt", "new", "F1-checkout", "--purpose", "again", "--json"]);
      assert.equal(field(parseBody(again.stdout), "error", "code"), "wt_taken");
    } finally {
      for (const id of ["F1-checkout", "F2-invites"]) {
        spawnSync("git", ["worktree", "unlock", join(repo.root, ".claude", "worktrees", id)], { cwd: repo.root });
      }
      repo.dispose();
    }
  });

  it("refuses temp folders outside the repo, nesting, and slow mounts", () => {
    const context = { mainRoot: "/home/ana/app", temps: ["/tmp"], linked: ["/home/ana/wt/f1"] };
    assert.deepEqual(placeProblems("/tmp/f2", context), ["temp"]);
    assert.deepEqual(placeProblems("/home/ana/wt/f1/inner", context), ["nested"]);
    assert.deepEqual(placeProblems("/mnt/c/Users/ana/f3", context), ["slow"]);
    assert.deepEqual(placeProblems("/home/ana/app/.claude/worktrees/f4", context), []);
    assert.deepEqual(placeProblems("/tmp/repo/.claude/worktrees/f5", { ...context, mainRoot: "/tmp/repo" }), []);
    assert.equal(
      toPosixPath(defaultPlace(toAbsolutePath("/mnt/c/Users/ana/OneDrive/app"), "/home/ana", "f6")),
      toPosixPath(toAbsolutePath("/home/ana/.finitemonkey/worktrees/app/f6")),
    );
  });

  it("allocates port ranges that do not overlap live entries", () => {
    assert.deepEqual(allocatePorts([], 5174), { from: 5174, to: 5183 });
  });
});
