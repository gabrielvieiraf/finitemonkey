import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { AbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { type BaseBoot, type SameRunDeps, sameRunPages, withSameRunBase } from "../src/look/base-run.js";
import { detectFramework, devStart, FRAMEWORKS, onboardManager } from "../src/look/dev-server.js";
import type { RouteMeasure, Sample } from "../src/look/perf.js";
import type { ProjectFiles } from "../src/task/implicit.js";
import { makeRepo, type Repo } from "./repo.js";
import { ROOT } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const TIMEOUT_MS = 5000;

const sample = (lcp: number): Sample => ({ lcp, cls: 0, tbt: 0, js: 2000, queries: 2 });

const fixturePackage = (framework: string): string =>
  readFileSync(join(ROOT, "test", "fixtures", "look-frameworks", framework, "package.json"), "utf8");

const filesOf = (files: Readonly<Record<string, string>>): ProjectFiles => ({
  read: (relative) => files[relative],
  exists: (relative) => files[relative] !== undefined,
});

interface Served {
  readonly commands: string[];
  readonly dirs: AbsolutePath[];
  stopped: number;
}

const fakeServer = (served: Served, boot?: BaseBoot): Pick<SameRunDeps, "freePort" | "boot" | "measure"> => ({
  freePort: () => Promise.resolve(4173),
  boot: (command, dir) => {
    served.commands.push(command);
    served.dirs.push(dir);
    return Promise.resolve(
      boot ?? {
        app: {
          stop: () => {
            served.stopped += 1;
            return Promise.resolve();
          },
        },
      },
    );
  },
  measure: () => {
    const dir = served.dirs[served.dirs.length - 1] ?? "";
    const lcp = Number(readFileSync(join(dir, "lcp.txt"), "utf8"));
    return Promise.resolve([{ route: "/", samples: [sample(lcp), sample(lcp), sample(lcp)], action: undefined }]);
  },
});

const repoWith = (framework: string): Repo => {
  const repo = makeRepo({ "package.json": fixturePackage(framework), "lcp.txt": "400" });
  repos.push(repo);
  return repo;
};

const depsFor = (repo: Repo, served: Served, boot?: BaseBoot): SameRunDeps => ({
  runtime: nodeRuntime(),
  root: repo.root,
  host: "127.0.0.1",
  timeoutMs: TIMEOUT_MS,
  declaredStart: undefined,
  ...fakeServer(served, boot),
});

const worktrees = (repo: Repo): number => repo.git("worktree", "list").trim().split("\n").length;

describe("look: same-run base in a throwaway worktree", () => {
  it("a planted regression is reported against the base commit and the worktree is gone afterwards", async () => {
    const repo = repoWith("vite");
    repo.write("lcp.txt", "2400");
    const served: Served = { commands: [], dirs: [], stopped: 0 };
    const base = await withSameRunBase(depsFor(repo, served));
    assert.equal(base.kind, "measured");
    assert.equal(served.stopped, 1);
    assert.equal(existsSync(served.dirs[0] ?? ""), false);
    assert.equal(worktrees(repo), 1);
    const current: readonly RouteMeasure[] = [
      { route: "/", samples: [sample(2400), sample(2400), sample(2400)], action: undefined },
    ];
    const issues = sameRunPages(base, current).flatMap((page) => page.issues);
    assert.deepEqual(
      issues.map((item) => [item.rule, item.selector, item.advisory]),
      [["perf/regression", "lcp", true]],
    );
    assert.equal(
      sameRunPages(base, [{ route: "/", samples: [sample(410)], action: undefined }]).flatMap((page) => page.issues)
        .length,
      0,
    );
  });

  it("a base app that does not start is reported as unverified and still cleaned up", async () => {
    const repo = repoWith("next");
    const served: Served = { commands: [], dirs: [], stopped: 0 };
    const base = await withSameRunBase(depsFor(repo, served, { detail: "port timeout" }));
    assert.deepEqual(base, { kind: "failed", step: "start", detail: "port timeout" });
    assert.equal(existsSync(served.dirs[0] ?? ""), false);
    assert.equal(worktrees(repo), 1);
    const issues = sameRunPages(base, []).flatMap((page) => page.issues);
    const [first] = issues;
    assert.equal(first?.unverified, true);
    assert.equal(first.advisory, true);
  });

  for (const framework of FRAMEWORKS)
    it(`the ${framework} fixture starts from its dev command, is captured and stops within the timeout`, async () => {
      const repo = repoWith(framework);
      const served: Served = { commands: [], dirs: [], stopped: 0 };
      const started = Date.now();
      const base = await withSameRunBase(depsFor(repo, served));
      assert.equal(base.kind, "measured");
      assert.equal(served.stopped, 1);
      assert.ok(Date.now() - started < TIMEOUT_MS);
      assert.match(served.commands[0] ?? "", new RegExp(`\\b${framework === "nuxt" ? "nuxi" : framework}\\b.*4173`));
      assert.equal(worktrees(repo), 1);
    });
});

describe("look: dev server start commands", () => {
  it("each framework fixture maps to its dev command on the given loopback port", () => {
    const commands = FRAMEWORKS.map((framework) => {
      const files = filesOf({ "package.json": fixturePackage(framework) });
      assert.equal(detectFramework(files), framework);
      return devStart(files, { declared: undefined, onboard: undefined, host: "127.0.0.1", port: 5000 })?.command;
    });
    assert.deepEqual(commands, [
      "npx --no-install next dev --port 5000 --hostname 127.0.0.1",
      "npx --no-install nuxi dev --port 5000 --host 127.0.0.1",
      "npx --no-install vite --port 5000 --host 127.0.0.1 --strictPort",
    ]);
  });

  it("the package manager comes from the onboarding record, then the lockfile, and look.yml start wins", () => {
    const onboard = { commands: [{ purpose: "test" as const, run: "pnpm run test" }], historyFindings: undefined };
    assert.equal(onboardManager(onboard), "pnpm");
    const files = filesOf({ "package.json": fixturePackage("vite"), "yarn.lock": "" });
    const input = { declared: undefined, host: "127.0.0.1", port: 1 };
    assert.match(devStart(files, { ...input, onboard })?.command ?? "", /^pnpm exec vite/);
    assert.match(devStart(files, { ...input, onboard: undefined })?.command ?? "", /^yarn vite/);
    assert.deepEqual(devStart(files, { ...input, declared: "make serve", onboard }), {
      command: "make serve",
      source: "look.yml",
      manager: "pnpm",
    });
    assert.equal(devStart(filesOf({ "package.json": "{}" }), { ...input, onboard }), undefined);
  });
});
