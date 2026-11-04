import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeHomeDir } from "../src/core/node-home.js";

describe("home directory", () => {
  it("is the one the system reports", () => {
    assert.equal(
      safeHomeDir(
        () => "/home/ana",
        () => "/tmp",
      ),
      "/home/ana",
    );
  });

  it("falls back to the temporary folder when the system cannot tell", () => {
    const missing = (): string => {
      throw new Error("uv_os_homedir returned ENOENT");
    };
    assert.equal(
      safeHomeDir(missing, () => "/tmp"),
      "/tmp",
    );
  });
});
