import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { bandLine, parseStatus } from "../src/mod/status.js";
import { makeRepo, NO_PR, PASSING_TEST, type Repo, repoRuntime } from "./repo.js";
import { cli, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const statusJson = async (root: Repo["root"]): Promise<string> => {
  const { stdout, code } = await cli(["status", "--json"], { cwd: root, runtime: repoRuntime() });
  assert.equal(code, 0, stdout);
  return stdout;
};

describe("finitemonkey status", () => {
  it("reports the gate, the contract and what an edit made stale, the same data the mod draws", async () => {
    const target = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
    repos.push(target);
    await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], {
      cwd: target.root,
      runtime: repoRuntime(),
    });
    target.write("src/a.js", "export const a = 2;\n");
    await cli(["gate"], { cwd: target.root, runtime: repoRuntime({ gh: NO_PR }) });
    const green = await statusJson(target.root);
    assert.equal(field(JSON.parse(green), "data", "schema"), "finitemonkey/status@1");
    const before = parseStatus(green);
    assert.ok(before !== undefined);
    assert.equal(before.task, "t");
    assert.match(before.contract?.hash ?? "", /^[0-9a-f]{8,}$/);
    assert.deepEqual(before.notVerified, []);
    target.write("src/a.js", "export const a = 3;\n");
    const after = parseStatus(await statusJson(target.root));
    assert.ok(after !== undefined);
    assert.ok(after.notVerified.some((item) => item.id === "tests" && item.reason === "stale"));
    assert.match(bandLine(after), /not verified/);
  });

  it("prints the same facts for people", async () => {
    const target = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
    repos.push(target);
    await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], {
      cwd: target.root,
      runtime: repoRuntime(),
    });
    const { stdout } = await cli(["status"], { cwd: target.root, runtime: repoRuntime() });
    assert.match(stdout, /gate none: 0\/\d+ checks passed \(task t\)/);
    assert.match(stdout, /not verified: tests/);
  });
});
