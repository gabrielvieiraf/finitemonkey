import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { build } from "esbuild";

import {
  adHocSignCommands,
  blobCommand,
  nodeProblems,
  postjectCommand,
  SEA_CONFIG_FILE,
  SEA_FUSE,
  SEA_URL_GLOBAL,
  seaAsset,
  seaBinary,
  seaBundleOptions,
  seaConfig,
  seaEntrySource,
  smokeProblems,
  targetFor,
  unsignCommands,
} from "../scripts/sea-lib.js";
import { ROOT } from "./support.js";

const DIST = readFileSync(join(ROOT, "dist", "finitemonkey-core.mjs"), "utf8");
const DOCTOR = JSON.stringify({
  schemaVersion: 1,
  data: { schema: "finitemonkey/doctor@1", checks: [{ check: "node" }] },
});

describe("standalone binary build", () => {
  it("the committed sea-config.json is the one the build script expects", () => {
    const committed: unknown = JSON.parse(readFileSync(join(ROOT, SEA_CONFIG_FILE), "utf8"));
    assert.deepEqual(committed, seaConfig());
  });

  it("turns the committed ESM bundle into a script with no top-level await and an embedded version", () => {
    const entry = seaEntrySource(DIST, "1.2.3");
    assert.deepEqual(entry.problems, []);
    assert.doesNotMatch(entry.source, /^#!/);
    assert.doesNotMatch(entry.source, /await main\(\);/);
    assert.match(entry.source, /^void main\(\);$/m);
    assert.match(entry.source, /version: "1\.2\.3",/);
  });

  it("refuses a bundle whose entry point or version read changed shape, and a version that is not semver", () => {
    assert.deepEqual(seaEntrySource("export {};", "1.2.3").problems, [
      "the bundle does not end with exactly one isEntryPoint call",
      "the bundle does not read its version exactly once",
    ]);
    assert.deepEqual(seaEntrySource(DIST, "v1").problems, ["v1 is not a semantic version"]);
    assert.equal(seaEntrySource(`${DIST}\n${DIST}`, "1.2.3").problems.length, 2);
  });

  it("esbuild bundles the entry as CommonJS with import.meta.url pointing at the executable", async () => {
    const entry = seaEntrySource(DIST, "1.2.3");
    const options = seaBundleOptions(entry.source, join(ROOT, "dist"), join(ROOT, "build", "sea", "test.cjs"));
    assert.equal(options.format, "cjs");
    assert.equal(options.define["import.meta.url"], SEA_URL_GLOBAL);
    const result = await build({ ...options, write: false });
    const [file] = result.outputFiles;
    assert.ok(file);
    assert.ok(
      file.text.includes(`const ${SEA_URL_GLOBAL} = require("node:url").pathToFileURL(process.execPath).href;`),
    );
    assert.doesNotMatch(file.text, /^export \{/m);
  });

  it("maps every runner platform to the release target and archive name of the manifests", () => {
    assert.deepEqual(targetFor("darwin", "arm64"), { os: "darwin", arch: "arm64" });
    assert.deepEqual(targetFor("linux", "x64"), { os: "linux", arch: "x64" });
    assert.deepEqual(targetFor("win32", "arm64"), { os: "windows", arch: "arm64" });
    assert.equal(targetFor("freebsd", "x64"), undefined);
    assert.equal(targetFor("linux", "ia32"), undefined);
    assert.equal(seaAsset("1.2.3", { os: "windows", arch: "x64" }), "finitemonkey-1.2.3-windows-x64.zip");
    assert.equal(seaAsset("1.2.3", { os: "darwin", arch: "arm64" }), "finitemonkey-1.2.3-darwin-arm64.tar.gz");
    assert.equal(seaBinary({ os: "windows", arch: "x64" }), "build/sea/finitemonkey.exe");
  });

  it("injects with the Node fuse, adds the Mach-O segment and re-signs ad hoc only on macOS", () => {
    const mac = { os: "darwin", arch: "arm64" } as const;
    const linux = { os: "linux", arch: "x64" } as const;
    assert.deepEqual(blobCommand("node"), ["node", "--experimental-sea-config", "sea-config.json"]);
    assert.deepEqual(postjectCommand("node", "cli.js", linux), [
      "node",
      "cli.js",
      "build/sea/finitemonkey",
      "NODE_SEA_BLOB",
      "build/sea/sea-prep.blob",
      "--sentinel-fuse",
      SEA_FUSE,
    ]);
    assert.deepEqual(postjectCommand("node", "cli.js", mac).slice(-2), ["--macho-segment-name", "NODE_SEA"]);
    assert.deepEqual(unsignCommands(mac), [["codesign", "--remove-signature", "build/sea/finitemonkey"]]);
    assert.deepEqual(adHocSignCommands(mac), [["codesign", "--sign", "-", "build/sea/finitemonkey"]]);
    assert.deepEqual([...unsignCommands(linux), ...adHocSignCommands(linux)], []);
  });

  it("builds only with the Node.js major the release workflow pins", () => {
    assert.deepEqual(nodeProblems("24.21.0"), []);
    assert.deepEqual(nodeProblems("22.1.0"), ["build the binary with Node.js 24, this is Node.js 22.1.0"]);
  });

  it("the smoke check wants the exact version and a doctor payload, and accepts a doctor that found problems", () => {
    assert.deepEqual(smokeProblems("1.2.3", { status: 0, stdout: "1.2.3\n" }, { status: 1, stdout: DOCTOR }), []);
    assert.deepEqual(smokeProblems("1.2.3", { status: 0, stdout: "0.0.0-unknown\n" }, { status: 0, stdout: DOCTOR }), [
      '--version printed "0.0.0-unknown", expected 1.2.3',
    ]);
    assert.deepEqual(smokeProblems("1.2.3", { status: 0, stdout: "1.2.3" }, { status: 0, stdout: "not json" }), [
      "doctor --json did not print a finitemonkey/doctor@1 payload",
    ]);
    assert.deepEqual(smokeProblems("1.2.3", { status: null, stdout: "" }, { status: 2, stdout: DOCTOR }), [
      "--version exited with null",
      '--version printed "", expected 1.2.3',
      "doctor --json exited with 2",
    ]);
  });
});
