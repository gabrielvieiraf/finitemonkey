import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { binPath, corePath } from "../src/core/bundle-files.js";
import { COMPILE_CACHE_DIR, compileCacheDir, enableCompileCache } from "../src/core/compile-cache.js";
import { BUNDLE, CORE } from "./support.js";

const base = mkdtempSync(join(tmpdir(), "fm-compile-cache-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const none = (): boolean => false;

const SUPPORTED = typeof Reflect.get(nodeModule, "enableCompileCache") === "function";

describe("compile cache directory", () => {
  it("lives under the home of the person, outside any project", () => {
    assert.equal(
      compileCacheDir({ HOME: "/home/ana" }, "linux", none),
      join("/home/ana", ".finitemonkey", "compile-cache"),
    );
    assert.equal(compileCacheDir({ HOME: "/Users/ana" }, "darwin", none), join("/Users/ana", COMPILE_CACHE_DIR));
  });

  it("is off when the home is a repository or inside one, so it never lands in a project", () => {
    const repo = join("/work", "dotfiles");
    const isRepo = (path: string): boolean => path === join(repo, ".git");
    assert.equal(compileCacheDir({ HOME: repo }, "linux", isRepo), undefined);
    assert.equal(compileCacheDir({ HOME: join(repo, "home", "ana") }, "linux", isRepo), undefined);
    assert.equal(
      compileCacheDir({ HOME: join("/work", "ana") }, "linux", isRepo),
      join("/work", "ana", COMPILE_CACHE_DIR),
    );
  });

  it("uses USERPROFILE on Windows", () => {
    const home = process.platform === "win32" ? "C:\\Users\\ana" : "/c/Users/ana";
    assert.equal(
      compileCacheDir({ USERPROFILE: home, HOME: "/elsewhere" }, "win32", none),
      join(home, COMPILE_CACHE_DIR),
    );
  });

  it("is off without an absolute home, so it never lands in the current folder", () => {
    assert.equal(compileCacheDir({}, "linux", none), undefined);
    assert.equal(compileCacheDir({ HOME: "" }, "linux", none), undefined);
    assert.equal(compileCacheDir({ HOME: "." }, "linux", none), undefined);
    assert.equal(compileCacheDir({ HOME: "/home/ana" }, "win32", none), undefined);
  });
});

describe("enabling the compile cache", () => {
  it("passes the directory to node:module", () => {
    const calls: unknown[] = [];
    const fake = { enableCompileCache: (dir: unknown) => calls.push(dir) };
    assert.equal(enableCompileCache(fake, "/home/ana/.finitemonkey/compile-cache"), true);
    assert.deepEqual(calls, ["/home/ana/.finitemonkey/compile-cache"]);
  });

  it("does nothing on a Node without enableCompileCache, such as Node 20", () => {
    assert.equal(enableCompileCache({}, "/home/ana/.finitemonkey/compile-cache"), false);
  });

  it("does nothing without a directory", () => {
    const calls: unknown[] = [];
    assert.equal(enableCompileCache({ enableCompileCache: (dir: unknown) => calls.push(dir) }, undefined), false);
    assert.deepEqual(calls, []);
  });

  it("never lets a failure stop the CLI", () => {
    const failing = {
      enableCompileCache: () => {
        throw new Error("EACCES");
      },
    };
    assert.equal(enableCompileCache(failing, "/root/.finitemonkey/compile-cache"), false);
  });
});

describe("launcher and core", () => {
  it("map to each other inside the same folder", () => {
    const bin = join("/opt", "fm", "dist", "finitemonkey.mjs");
    const core = join("/opt", "fm", "dist", "finitemonkey-core.mjs");
    assert.equal(corePath(bin), core);
    assert.equal(binPath(core), bin);
    assert.equal(binPath(bin), bin);
    assert.equal(
      binPath(join("/repo", "src", "core", "node-runtime.ts")),
      join("/repo", "src", "core", "node-runtime.ts"),
    );
  });

  const copy = (name: string): string => {
    const dir = join(base, name, "dist");
    mkdirSync(dir, { recursive: true });
    copyFileSync(BUNDLE, join(dir, "finitemonkey.mjs"));
    copyFileSync(CORE, join(dir, "finitemonkey-core.mjs"));
    return join(dir, "finitemonkey.mjs");
  };

  const launch = (bin: string, cwd: string, env: Readonly<Record<string, string>>) =>
    spawnSync(process.execPath, [bin, "--version"], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", ...env },
    });

  it("writes the cache under the home and nothing into the project", { skip: !SUPPORTED }, () => {
    const bin = copy("with home");
    const home = join(base, "home");
    const project = join(base, "project");
    mkdirSync(project, { recursive: true });
    const result = launch(bin, project, { HOME: home, USERPROFILE: home });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
    assert.ok(readdirSync(join(home, COMPILE_CACHE_DIR)).length > 0);
    assert.deepEqual(readdirSync(project), []);
  });

  it("writes no cache when the home is the repository it runs in", () => {
    const bin = copy("home is repo");
    const repo = join(base, "repo as home");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const result = launch(bin, repo, { HOME: repo, USERPROFILE: repo });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(repo), [".git"]);
  });

  it("runs without a cache when the home is relative", () => {
    const bin = copy("relative home");
    const project = join(base, "relative");
    mkdirSync(project, { recursive: true });
    const result = launch(bin, project, { HOME: ".", USERPROFILE: "." });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
    assert.deepEqual(readdirSync(project), []);
  });

  it("fails loudly when the core next to it is missing", () => {
    const dir = join(base, "no core");
    mkdirSync(dir, { recursive: true });
    copyFileSync(BUNDLE, join(dir, "finitemonkey.mjs"));
    const result = launch(join(dir, "finitemonkey.mjs"), dir, {});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /finitemonkey-core\.mjs/);
    assert.equal(existsSync(join(dir, ".finitemonkey")), false);
  });
});
