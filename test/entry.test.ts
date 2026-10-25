import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { isEntryPoint } from "../src/core/entry.js";
import { nodeRealpath } from "../src/core/node-runtime.js";
import { BUNDLE, bundle, field, parseBody, ROOT } from "./support.js";

const base = mkdtempSync(join(tmpdir(), "fm-entry-"));
const pkg = join(base, "Área de Trabalho", "pasta com espaço", "ação");
const copied = join(pkg, "dist", "finitemonkey.mjs");
mkdirSync(join(pkg, "dist"), { recursive: true });
copyFileSync(BUNDLE, copied);
copyFileSync(join(ROOT, "package.json"), join(pkg, "package.json"));
const version = field(parseBody(readFileSync(join(ROOT, "package.json"), "utf8")), "version");

after(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("entry point detection", () => {
  const url = pathToFileURL(copied).href;
  const identity = (path: string): string => path;
  const cases = [
    { argv1: copied, platform: "linux", expected: true },
    { argv1: join(base, "other.mjs"), platform: "linux", expected: false },
    { argv1: undefined, platform: "linux", expected: false },
  ] as const;
  for (const { argv1, platform, expected } of cases) {
    it(`${String(argv1)} on ${platform} is ${expected ? "" : "not "}the entry`, () => {
      assert.match(url, /%20/);
      assert.equal(isEntryPoint(url, argv1, identity, platform), expected);
    });
  }

  it("compares case-insensitively on Windows", () => {
    assert.equal(
      isEntryPoint("file:///C:/Pasta%20A/fm.mjs", "c:\\pasta a\\FM.mjs", identity, "win32"),
      process.platform === "win32",
    );
  });

  it("bundle prints the version from a path with spaces and accents", () => {
    const result = bundle(["--version"], undefined, {}, copied);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), version);
  });

  it("bundle runs through a symlink like an npm bin shim", { skip: process.platform === "win32" }, () => {
    const binDir = join(base, "prefixo com espaço", "bin");
    mkdirSync(binDir, { recursive: true });
    const link = join(binDir, "fm");
    symlinkSync(copied, link);
    assert.equal(nodeRealpath(link), nodeRealpath(copied));
    const result = bundle(["version", "--json"], undefined, {}, link);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(field(parseBody(result.stdout), "data", "version"), version);
  });
});
