import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRootLike, isWithin, pathKey, resolveFrom } from "../src/git/path-key.js";
import { rmVerdict } from "../src/git/rm-guard.js";
import { normalizeCommand } from "../src/shell/normalize.js";
import type { Dialect } from "../src/shell/types.js";
import { fakeRuntime } from "./support.js";

describe("path keys across Windows, WSL and POSIX", () => {
  const SAME: readonly (readonly [string, string])[] = [
    ["C:\\Users\\ana\\repo", "c:/users/ana/repo"],
    ["C:\\Users\\ana\\repo\\", "c:/Users/ana/repo"],
    ["/mnt/c/Users/ana/repo", "C:\\Users\\ana\\repo"],
    ["D:/work/../work/app", "d:\\work\\app"],
    ["/home/ana/repo/", "/home/ana/repo"],
  ];
  for (const [left, right] of SAME) {
    it(`${left} == ${right}`, () => {
      assert.equal(pathKey(left), pathKey(right));
    });
  }

  it("keeps POSIX paths case-sensitive", () => {
    assert.notEqual(pathKey("/home/Ana"), pathKey("/home/ana"));
  });

  it("checks containment through separators", () => {
    assert.ok(isWithin("C:\\repo\\wt\\src", "c:/repo/wt"));
    assert.ok(!isWithin("C:\\repo\\wt-old", "c:/repo/wt"));
  });

  it("treats a drive root and the home as root-like", () => {
    assert.ok(isRootLike("C:\\", undefined));
    assert.ok(isRootLike("C:\\Users\\ana", "c:/users/ana"));
    assert.ok(!isRootLike("C:\\Users\\ana\\repo", "c:/users/ana"));
  });

  it("resolves relative parts against a Windows base", () => {
    assert.equal(pathKey(resolveFrom("C:\\repo", "..\\wt")), "c:/wt");
  });
});

describe("rm guard with Windows-style paths", () => {
  const runtime = fakeRuntime();
  const context = { cwd: "C:\\repo", home: "C:\\Users\\ana", worktrees: () => [pathKey("C:\\repo-wt")] };
  const verdict = (text: string, dialect: Dialect): string => {
    const [command] = normalizeCommand(text, dialect).commands;
    assert.ok(command);
    return rmVerdict(runtime, context, command).kind;
  };

  it("blocks Remove-Item -Recurse on a worktree", () => {
    assert.equal(verdict("Remove-Item -Recurse -Force C:\\repo-wt", "powershell"), "block");
    assert.equal(verdict("rm -r -fo ..\\repo-wt", "powershell"), "block");
  });

  it("blocks rm -rf of the home or a drive root", () => {
    assert.equal(verdict("Remove-Item -Recurse C:\\", "powershell"), "block");
    assert.equal(verdict("rm -rf /mnt/c/Users/ana", "bash"), "block");
  });

  it("passes removal of a build folder", () => {
    assert.equal(verdict("Remove-Item -Recurse -Force C:\\repo\\dist", "powershell"), "pass");
    assert.equal(verdict("rm -rf node_modules", "bash"), "pass");
  });
});
