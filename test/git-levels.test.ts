import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { checkGithubRules, invalidCodeownersLines } from "../src/doctor/github.js";
import { gitPreToolUse } from "../src/git/hooks/pre-tool.js";
import { githubStep } from "../src/github/step.js";
import { prPreToolUse } from "../src/pr/hooks.js";
import { levelPreToolUse } from "../src/profile/git-hook.js";
import { gitLevel } from "../src/profile/level.js";
import { bash, git, hook, tempRepo, write } from "./git-support.js";
import { cli, execResult, fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const HOME_PROFILE = toAbsolutePath("/home/test/.finitemonkey/profile.yml");

const githubRuntime = (calls: ExecRequest[], protectedBranch: boolean) =>
  fakeRuntime({
    exec: (request) => {
      calls.push(request);
      const args = request.args.join(" ");
      if (args.startsWith("repo view")) {
        return execResult(0, JSON.stringify({ nameWithOwner: "acme/app", defaultBranchRef: { name: "main" } }));
      }
      if (args.includes("/rules/branches/")) return execResult(0, protectedBranch ? '[{"type":"deletion"}]' : "[]");
      if (args.includes("/protection")) return execResult(1, "", "Branch not protected");
      if (args.includes("--method POST")) return execResult(0, "{}");
      return undefined;
    },
  });

const posts = (calls: readonly ExecRequest[]): number =>
  calls.filter((call) => call.args.join(" ").includes("--method POST")).length;

describe("GitHub ruleset proposal", () => {
  it("nothing is written to GitHub without the person's yes", () => {
    const calls: ExecRequest[] = [];
    const runtime = githubRuntime(calls, false);
    const step = githubStep(runtime, ROOT, false);
    assert.equal(step.applied, false);
    assert.equal(step.proposal, ".finitemonkey/github-ruleset.json");
    assert.equal(
      step.command,
      "gh api --method POST repos/acme/app/rulesets --input .finitemonkey/github-ruleset.json",
    );
    assert.equal(posts(calls), 0);
    const proposal = runtime.readText(toAbsolutePath(`${ROOT}/.finitemonkey/github-ruleset.json`));
    assert.ok(proposal.ok);
    assert.match(proposal.value, /"non_fast_forward"/);
    assert.match(proposal.value, /"require_code_owner_review": true/);
    assert.match(proposal.value, /"merge_queue"/);
    const confirmed = githubStep(runtime, ROOT, true);
    assert.equal(confirmed.applied, true);
    assert.equal(posts(calls), 1);
  });

  it("init --github --yes run by the agent proposes but never posts", async () => {
    const calls: ExecRequest[] = [];
    const run = await cli(["init", "--github", "--yes", "--json"], { runtime: githubRuntime(calls, false), cwd: ROOT });
    assert.match(run.stdout, /github-ruleset\.json/);
    assert.equal(posts(calls), 0);
  });

  it("a protected default branch gets no proposal", () => {
    const calls: ExecRequest[] = [];
    const step = githubStep(githubRuntime(calls, true), ROOT, true);
    assert.equal(step.proposal, null);
    assert.equal(posts(calls), 0);
  });

  it("without a ruleset the default branch stays protected locally", async () => {
    const repo = tempRepo();
    try {
      write(
        repo.root,
        ".finitemonkey/cache/github.json",
        JSON.stringify({ repo: "acme/app", defaultBranch: "main", rules: [] }),
      );
      write(repo.root, "a.txt", "a\n");
      git(repo.root, "add", "a.txt");
      const decision = await hook(gitPreToolUse, "PreToolUse", repo.root, bash("git commit -m 'feat: a'"));
      assert.equal(decision.kind, "block");
      const findings = checkGithubRules({
        platform: "linux",
        env: {},
        cwd: repo.root,
        root: repo.root,
        version: "1.0.0",
        runtime: fakeRuntime({
          files: {
            [`${repo.root}/.finitemonkey/cache/github.json`]: JSON.stringify({
              repo: "acme/app",
              defaultBranch: "main",
              rules: [],
            }),
          },
        }),
      });
      assert.equal(findings[0]?.messageKey, "doctor.github.no_ruleset");
    } finally {
      repo.dispose();
    }
  });
});

describe("doctor: merge queue and CODEOWNERS", () => {
  it("flags a queue without merge_group and CODEOWNERS lines GitHub skips", () => {
    const cache = JSON.stringify({ repo: "acme/app", defaultBranch: "main", rules: ["merge_queue"], mergeQueue: true });
    const runtime = fakeRuntime({
      files: {
        [`${ROOT}/.finitemonkey/cache/github.json`]: cache,
        [`${ROOT}/.github/workflows/ci.yml`]: "on:\n  pull_request:\n",
        [`${ROOT}/.github/CODEOWNERS`]: "* @acme/core\nsrc/api/ owner-without-at\n!docs @ana\n",
      },
    });
    const findings = checkGithubRules({ platform: "linux", env: {}, cwd: ROOT, root: ROOT, version: "1.0.0", runtime });
    const keys = findings.map((item) => item.messageKey);
    assert.ok(keys.includes("doctor.github.queue_without_merge_group"));
    assert.ok(keys.includes("doctor.github.codeowners_invalid"));
    assert.deepEqual(invalidCodeownersLines("* @acme/core\nsrc/api/ owner-without-at\n!docs @ana\n"), [2, 3]);
  });
});

const withLevel = (root: AbsolutePath, level: string): void => {
  write(root, ".finitemonkey/profile.yml", `domains:\n  infrastructure: ${level}\n`);
};

describe("git defaults by level", () => {
  it("the level comes from the profile and defaults to intermediate", () => {
    const repo = tempRepo();
    try {
      const runtime = fakeRuntime({ files: {} });
      assert.equal(gitLevel(runtime, repo.root), "intermediate");
      const fromHome = fakeRuntime({ files: { [HOME_PROFILE]: "domains:\n  infrastructure: advanced\n" } });
      assert.equal(gitLevel(fromHome, repo.root), "advanced");
      const project = fakeRuntime({
        files: {
          [`${repo.root}/.finitemonkey/profile.yml`]: "domains:\n  infrastructure: beginner\n",
          [HOME_PROFILE]: "domains:\n  infrastructure: advanced\n",
        },
      });
      assert.equal(gitLevel(project, repo.root), "beginner");
    } finally {
      repo.dispose();
    }
  });

  it("merging a pull request, rebasing and force-with-lease follow the level", async () => {
    const repo = tempRepo();
    try {
      const kind = async (handler: typeof prPreToolUse, command: string) =>
        hook(handler, "PreToolUse", repo.root, bash(command));
      assert.equal((await kind(prPreToolUse, "gh pr merge 3 --squash")).kind, "block");
      assert.equal((await kind(prPreToolUse, "gh pr merge 3 --auto --squash")).kind, "allow");
      assert.equal((await kind(levelPreToolUse, "git rebase main")).kind, "allow");
      const lease = "git push --force-with-lease=feat/x:abc --force-if-includes origin feat/x";
      assert.doesNotMatch(JSON.stringify(await kind(levelPreToolUse, lease)), /"ask"/);
      withLevel(repo.root, "beginner");
      assert.equal((await kind(prPreToolUse, "gh pr merge 3 --auto --squash")).kind, "block");
      assert.equal((await kind(levelPreToolUse, "git rebase main")).kind, "block");
      assert.equal((await kind(levelPreToolUse, "git pull --rebase")).kind, "block");
      assert.equal((await kind(levelPreToolUse, "git rebase --abort")).kind, "allow");
      assert.match(JSON.stringify(await kind(levelPreToolUse, lease)), /"permissionDecision":"ask"/);
      assert.doesNotMatch(JSON.stringify(await kind(levelPreToolUse, `${lease} --dry-run`)), /"ask"/);
      withLevel(repo.root, "advanced");
      assert.equal((await kind(prPreToolUse, "gh pr merge 3 --squash")).kind, "allow");
    } finally {
      repo.dispose();
    }
  });
});
