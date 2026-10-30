import "./support.js";

import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { describe, it } from "node:test";

import { nodeRuntime } from "../src/core/node-runtime.js";
import { keyPath } from "../src/evidence/sign.js";

describe("test home isolation", () => {
  it("points the home folder at a temporary directory", () => {
    const home = process.env["FM_TEST_HOME"];
    assert.ok(home !== undefined);
    assert.equal(homedir(), home);
    assert.ok(home.startsWith(realpathSync.native(tmpdir())));
  });

  it("keeps the ledger signing key inside the temporary home", () => {
    const home = process.env["FM_TEST_HOME"] ?? "";
    assert.ok(keyPath(nodeRuntime()).startsWith(home));
  });
});
