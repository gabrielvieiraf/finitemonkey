import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ExitCode } from "../src/exit-codes.js";
import { VERIFY_SKILL } from "../src/install/layout.js";
import { actions, at, repo, run } from "./install-support.js";

describe("the project verify skill", () => {
  it("is created with the frontmatter skills need and runs the fast gate through the chosen runner", async () => {
    const vendored = repo();
    assert.equal((await run(vendored, ["init", "--yes"])).code, ExitCode.Ok);
    const skill = vendored.read(at(VERIFY_SKILL)) ?? "";
    assert.match(skill, /^---\nname: verify\ndescription: /);
    assert.match(skill, /`node \.finitemonkey\/runtime\/dist\/finitemonkey\.mjs gate --fast --json`/);
    const local = repo({ "node_modules/finitemonkey/dist/finitemonkey.mjs": "" });
    assert.equal((await run(local, ["init", "--yes"])).code, ExitCode.Ok);
    assert.match(local.read(at(VERIFY_SKILL)) ?? "", /`node node_modules\/finitemonkey\/dist\/finitemonkey\.mjs gate/);
  });

  it("an existing project verify skill is listed, never overwritten and survives uninstall", async () => {
    const mine = "---\nname: verify\ndescription: our own checks\n---\n\nRun make check.\n";
    const fs = repo({ [VERIFY_SKILL]: mine });
    const installed = await run(fs, ["init", "--yes"]);
    assert.equal(installed.code, ExitCode.Ok);
    assert.equal(actions(installed.body)[VERIFY_SKILL], "skip-foreign");
    assert.equal(fs.read(at(VERIFY_SKILL)), mine);
    assert.equal((await run(fs, ["uninstall", "--yes", "--purge"])).code, ExitCode.Ok);
    assert.equal(fs.read(at(VERIFY_SKILL)), mine);
  });
});
