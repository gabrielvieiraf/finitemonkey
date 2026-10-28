import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { tempProject } from "./gen-support.js";
import { cliJson, fakeRuntime, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const at = (path: string): string => toAbsolutePath(path, ROOT);

const NODE_PROJECT = {
  "package.json": JSON.stringify({
    name: "app",
    scripts: { lint: "eslint .", test: "vitest run", build: "tsc", typecheck: "tsc --noEmit" },
    devDependencies: { prettier: "*", eslint: "*" },
  }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "tsconfig.json": "{}\n",
};

const ALL = ["--with", "deploy,release,review", "--oidc"];

const generate = async (files: Readonly<Record<string, string>>, argv: readonly string[] = []) => {
  const runtime = fakeRuntime({
    files: Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
  });
  const run = await cliJson(["ci", "gen", "--yes", ...argv], { runtime, cwd: ROOT });
  const read = (path: string): string => {
    const text = runtime.readText(toAbsolutePath(at(path)));
    return text.ok ? text.value : "";
  };
  return { run, runtime, read };
};

const WORKFLOWS = ["ci", "deploy", "release", "security", "claude-review"].map(
  (name) => `.github/workflows/${name}.yml`,
);

const jobBlocks = (text: string): readonly string[] =>
  (text.split(/^jobs:\n/m)[1] ?? "").split(/\n(?= {2}[a-z][\w-]*:\n)/).filter((block) => block.trim() !== "");

describe("ci gen", () => {
  it("writes every workflow with read-only permissions on top, concurrency, timeouts and actions pinned by SHA", async () => {
    const { run, read } = await generate(NODE_PROJECT, ALL);
    assert.equal(run.code, 0, run.stdout);
    for (const path of WORKFLOWS) {
      const text = read(path);
      assert.match(text, /^permissions:\n {2}contents: read\n/m, path);
      assert.match(text, /^concurrency:\n {2}group: .+\n {2}cancel-in-progress: \S+/m, path);
      for (const job of jobBlocks(text)) assert.match(job, /timeout-minutes: \d+/, `${path}: ${job.slice(0, 40)}`);
      const uses = [...text.matchAll(/uses: (\S+)(.*)$/gm)];
      assert.ok(uses.length > 0, path);
      for (const [, action = "", comment = ""] of uses) {
        assert.match(action, /@[0-9a-f]{40}$/, `${path}: ${action}`);
        assert.match(comment, /^ # v\d/, `${path}: ${action}`);
      }
      assert.doesNotMatch(text, /persist-credentials: true|write-all/, path);
    }
  });

  it("ci.yml installs from the lockfile, runs types, format, lint, tests and build, and ends with the single gate step", async () => {
    const { read } = await generate(NODE_PROJECT);
    const ci = read(".github/workflows/ci.yml");
    const order = [
      "pnpm install --frozen-lockfile",
      "pnpm run typecheck",
      "pnpm exec prettier --check .",
      "pnpm run lint",
      "pnpm run test",
      "pnpm run build",
      " ci gate\n",
    ].map((text) => ci.lastIndexOf(text));
    assert.ok(
      order.every((index) => index > 0),
      order.join(","),
    );
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
    );
    assert.equal((ci.match(/^\s+run: .* ci gate$/gm) ?? []).length, 1);
    assert.match(ci, /name: finitemonkey ci gate/);
    assert.doesNotMatch(ci, /merge_group/);
  });

  it("adds merge_group when the repository has a merge queue", async () => {
    const cache = JSON.stringify({ repo: "acme/app", defaultBranch: "main", rules: ["merge_queue"], mergeQueue: true });
    const { read } = await generate({ ...NODE_PROJECT, ".finitemonkey/cache/github.json": cache });
    assert.match(read(".github/workflows/ci.yml"), /^ {2}merge_group:$/m);
  });

  it("deploy runs after a green CI on push, in the production environment, without cancelling, with id-token only there", async () => {
    const { read } = await generate(NODE_PROJECT, ALL);
    const deploy = read(".github/workflows/deploy.yml");
    assert.match(deploy, /workflow_run:\n {4}workflows: \[CI\]/);
    assert.match(deploy, /conclusion == 'success' && github\.event\.workflow_run\.event == 'push'/);
    assert.match(deploy, /environment: production/);
    assert.match(deploy, /cancel-in-progress: false/);
    assert.match(deploy, /id-token: write/);
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /id-token/);
    const { read: withoutOidc } = await generate(NODE_PROJECT, ["--with", "deploy"]);
    assert.doesNotMatch(withoutOidc(".github/workflows/deploy.yml"), /id-token/);
  });

  it("release checks the tag signature and publishes changelog, SBOM and provenance", async () => {
    const { read } = await generate(NODE_PROJECT, ALL);
    const release = read(".github/workflows/release.yml");
    for (const part of [
      ".verification.verified",
      "anchore/sbom-action",
      "attest-build-provenance",
      "--generate-notes",
    ]) {
      assert.ok(release.includes(part), part);
    }
  });

  it("security runs on a schedule with history secrets, osv-scanner and ci audit; Dependabot covers actions", async () => {
    const { read } = await generate(NODE_PROJECT);
    const security = read(".github/workflows/security.yml");
    for (const part of ["schedule:", "secrets scan --history", "osv-scanner-action", "ci audit"]) {
      assert.ok(security.includes(part), part);
    }
    assert.match(read(".github/dependabot.yml"), /package-ecosystem: github-actions/);
    assert.match(read(".github/dependabot.yml"), /package-ecosystem: npm/);
  });

  it("the review workflow uses its own app, a custom trigger and minimal permissions, and is never the gate", async () => {
    const { read } = await generate(NODE_PROJECT, ALL);
    const review = read(".github/workflows/claude-review.yml");
    assert.match(review, /create-github-app-token/);
    assert.match(review, /trigger_phrase: "@finitemonkey-review"/);
    assert.match(review, /author_association/);
    assert.doesNotMatch(review, /pull_request_target|contents: write/);
    assert.doesNotMatch(read(".github/workflows/ci.yml"), /claude-code-action/);
  });

  it("adds the attribution job unless the project turned no-attribution off", async () => {
    const on = await generate(NODE_PROJECT);
    assert.match(on.read(".github/workflows/ci.yml"), /no AI attribution/);
    const off = await generate({ ...NODE_PROJECT, ".finitemonkey/config.yml": "defaults:\n  no-attribution: off\n" });
    assert.doesNotMatch(off.read(".github/workflows/ci.yml"), /no AI attribution/);
  });

  it("a Python project gets setup-python, a locked uv sync, ruff and pytest", async () => {
    const { read } = await generate({
      "pyproject.toml": '[project]\nname = "app"\n[dependency-groups]\ndev = ["ruff", "pytest"]\n',
      "uv.lock": "version = 1\n",
    });
    const ci = read(".github/workflows/ci.yml");
    for (const part of [
      "actions/setup-python",
      "astral-sh/setup-uv",
      "uv sync --locked",
      "uv run ruff check .",
      "uv run pytest",
    ]) {
      assert.ok(ci.includes(part), part);
    }
  });

  it("shows an existing workflow as a diff and never overwrites it", async () => {
    const mine = "name: Mine\non: push\njobs: {}\n";
    const { run, read } = await generate({ ...NODE_PROJECT, ".github/workflows/ci.yml": mine });
    assert.equal(read(".github/workflows/ci.yml"), mine);
    const entries = field(run.body, "data", "entries");
    assert.ok(Array.isArray(entries));
    assert.ok(
      entries.some(
        (entry) => field(entry, "path") === ".github/workflows/ci.yml" && field(entry, "status") === "differs",
      ),
    );
  });

  it("rejects an unknown workflow name", async () => {
    const { run } = await generate(NODE_PROJECT, ["--with", "pages"]);
    assert.equal(run.code, 2);
  });

  const actionlint = spawnSync("actionlint", ["-version"], { encoding: "utf8" }).status === 0;
  it("every generated workflow passes actionlint", { skip: !actionlint }, async () => {
    const project = tempProject(NODE_PROJECT, false);
    try {
      spawnSync("git", ["init", "-q"], { cwd: project.root });
      const run = await project.run(["ci", "gen", "--yes", ...ALL]);
      assert.equal(run.code, 0, run.stdout);
      const lint = spawnSync("actionlint", ["-no-color"], { cwd: project.root, encoding: "utf8" });
      assert.equal(lint.status, 0, lint.stdout + lint.stderr);
    } finally {
      project.cleanup();
    }
  });
});
