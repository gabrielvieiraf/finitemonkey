import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { bandLine, parseStatus } from "../src/mod/status.js";
import { recordHorizon } from "../src/signals/blind-band.js";
import { fmPaths } from "../src/task/paths.js";
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

  it("puts the blind band index of the week next to the loop index", async () => {
    const target = makeRepo({ "src/a.js": "export const a = 1;\n", "test/a.test.js": PASSING_TEST });
    repos.push(target);
    await cli(["task", "new", "t", "--goal", "g", "--tests", "node --test"], {
      cwd: target.root,
      runtime: repoRuntime(),
    });
    const runtime = repoRuntime();
    const paths = fmPaths(toAbsolutePath(target.root));
    recordHorizon(runtime, paths, { source: "skill", criterion: "none", domain: "backend" });
    recordHorizon(runtime, paths, { source: "skill", criterion: "example", domain: "backend" });
    recordHorizon(runtime, paths, { source: "skill", criterion: "example", domain: "security" });
    const view = parseStatus(await statusJson(target.root));
    assert.deepEqual(
      [view?.blindBand?.domain, view?.blindBand?.index, view?.blindBand?.withoutCriterion, view?.blindBand?.helps],
      ["backend", 0.5, 1, 2],
    );
    assert.ok(view !== undefined);
    assert.match(
      bandLine({ ...view, loop: { count: 2, limit: 4 } }),
      /blind band backend 0\.50 ▅ \(1\/2 help without criterion\) · loop 2\/4/,
    );
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
