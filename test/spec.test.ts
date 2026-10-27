import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, ROOT } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures", "spec");
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const project = (name: string): Repo => {
  const repo = makeRepo({ "README.md": "# app\n" });
  repos.push(repo);
  cpSync(join(FIXTURES, name), repo.root, { recursive: true });
  return repo;
};

const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const criteria = (body: Record<string, unknown>) => {
  const items = field(body, "data", "criteria");
  assert.ok(Array.isArray(items));
  return items.map((item: unknown) => [
    String(field({ item }, "item", "from")),
    String(field({ item }, "item", "kind")),
    field({ item }, "item", "checkable"),
  ]);
};

describe("finitemonkey task from-spec", () => {
  it("reads a Spec Kit tasks.md, marks criteria without a check and leaves the file as it was", async () => {
    const repo = project("speckit");
    const file = join(repo.root, "specs", "001-checkout", "tasks.md");
    const before = sha(file);
    const run = await cliJson(["task", "from-spec", "specs/001-checkout/tasks.md", "--port", "3000"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(run.code, 0, JSON.stringify(run.body));
    assert.equal(field(run.body, "data", "format"), "speckit");
    assert.deepEqual(criteria(run.body), [
      ["T001", "manual", false],
      ["T002", "command", true],
      ["T003", "runtime", true],
      ["T004", "manual", false],
    ]);
    assert.match(String(field(run.body, "data", "contract")), /route: \/health\n {4}status: 200/);
    assert.equal(sha(file), before);
    assert.equal(field(run.body, "data", "sourceSha256"), before);
  });

  it("reads an OpenSpec change, turns EARS and scenarios into criteria and writes the contract only with --id", async () => {
    const repo = project("openspec");
    const tasks = join(repo.root, "openspec", "changes", "add-pix", "tasks.md");
    const before = sha(tasks);
    const proposal = await cliJson(["task", "from-spec", "openspec/changes/add-pix/tasks.md"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(field(proposal.body, "data", "format"), "openspec");
    assert.deepEqual(criteria(proposal.body), [
      ["1.1", "manual", false],
      ["1.2", "command", true],
      ["2.1", "manual", false],
    ]);
    assert.equal(field(proposal.body, "data", "written"), false);
    assert.throws(() => repo.read(".finitemonkey/tasks/add-pix.yml"));
    const spec = await cliJson(
      ["task", "from-spec", "openspec/changes/add-pix/specs/payments/spec.md", "--port", "8080"],
      {
        cwd: repo.root,
        runtime: repoRuntime(),
      },
    );
    assert.deepEqual(criteria(spec.body), [["scenario-6", "manual", false]]);
    const written = await cliJson(["task", "from-spec", "openspec/changes/add-pix/tasks.md", "--id", "add-pix"], {
      cwd: repo.root,
      runtime: repoRuntime(),
    });
    assert.equal(field(written.body, "data", "written"), true);
    assert.match(repo.read(".finitemonkey/tasks/add-pix.yml"), /run: pnpm vitest run payments/);
    assert.equal(sha(tasks), before);
  });
});
