import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { assetName, parseChecksums, resolveRelease, TARGETS } from "../scripts/release-assets.js";
import { releaseManifests } from "../scripts/release-files.js";
import { validateHomebrew } from "../scripts/release-homebrew.js";
import { scoopManifest, validateScoop } from "../scripts/release-scoop.js";
import { validateWinget, wingetFiles } from "../scripts/release-winget.js";
import { ROOT } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures", "release");
const CHECKSUMS = readFileSync(join(FIXTURES, "SHA256SUMS"), "utf8");
const FAKE_HASH = "0".repeat(64);

const release = () => {
  const resolved = resolveRelease("1.2.3", parseChecksums(CHECKSUMS).sums);
  assert.ok(resolved.release);
  return resolved.release;
};

describe("release manifests", () => {
  it("generate the Homebrew formula, the Scoop manifest and the three winget manifests from the fixtures", () => {
    const result = releaseManifests("1.2.3", CHECKSUMS);
    assert.deepEqual(result.problems, []);
    assert.equal(result.files.length, 5);
    for (const file of result.files) {
      assert.equal(file.content, readFileSync(join(FIXTURES, "expected", ...file.path.split("/")), "utf8"), file.path);
    }
  });

  it("the Scoop manifest is JSON with every architecture checksum from the release", () => {
    const result = releaseManifests("1.2.3", CHECKSUMS);
    const scoop = result.files.find((file) => file.path === "scoop/finitemonkey.json");
    assert.ok(scoop);
    const parsed: unknown = JSON.parse(scoop.content);
    assert.deepEqual(parsed, JSON.parse(JSON.stringify(scoopManifest(release()))));
  });

  it("fails closed when an archive has no checksum", () => {
    const partial = CHECKSUMS.split("\n")
      .filter((line) => !line.endsWith(assetName("1.2.3", { os: "windows", arch: "arm64" })))
      .join("\n");
    const result = releaseManifests("1.2.3", partial);
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.problems, ["no checksum for finitemonkey-1.2.3-windows-arm64.zip"]);
  });

  it("fails closed on a malformed or repeated checksum line", () => {
    const name = assetName("1.2.3", { os: "linux", arch: "x64" });
    const result = releaseManifests("1.2.3", `${CHECKSUMS}not a checksum\n${FAKE_HASH}  ${name}\n`);
    assert.deepEqual(result.files, []);
    assert.equal(result.problems.length, 2);
  });

  it("rejects a version that is not semantic", () => {
    assert.deepEqual(releaseManifests("v1.2", CHECKSUMS).problems, ["v1.2 is not a semantic version"]);
  });

  it("accepts a pre-release version from the next channel", () => {
    const version = "0.1.0-next.42";
    const sums = TARGETS.map((target) => `${FAKE_HASH}  ${assetName(version, target)}`).join("\n");
    const result = releaseManifests(version, sums);
    assert.deepEqual(result.problems, []);
    assert.ok(result.files.some((file) => file.path.includes(`/FiniteMonkey/${version}/`)));
  });

  it("the validators report a broken checksum, url or manifest", () => {
    const good = release();
    const broken = {
      ...good,
      assets: good.assets.map((asset) => ({ ...asset, sha256: "XYZ", url: asset.url.replace("https:", "http:") })),
    };
    assert.ok(validateHomebrew(broken).some((problem) => problem.includes("sha256")));
    assert.ok(validateScoop(scoopManifest(broken)).some((problem) => problem.includes("hash")));
    const winget = wingetFiles(broken);
    assert.ok(validateWinget(winget).some((problem) => problem.includes("InstallerSha256")));
    assert.ok(validateWinget(winget.slice(1)).includes("no version manifest"));
    assert.deepEqual(validateWinget(wingetFiles(good)), []);
  });

  it("the command writes the files and exits 1 without writing when a checksum is missing", () => {
    const out = mkdtempSync(join(tmpdir(), "fm-release-"));
    try {
      const script = join(ROOT, "scripts", "release-manifests.ts");
      const args = ["--import", "tsx", script, "--version", "1.2.3", "--out", out, "--checksums"];
      const ok = spawnSync(process.execPath, [...args, join(FIXTURES, "SHA256SUMS")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(ok.status, 0, ok.stderr);
      const formula = readFileSync(join(out, "homebrew", "finitemonkey.rb"), "utf8");
      assert.equal(formula, readFileSync(join(FIXTURES, "expected", "homebrew", "finitemonkey.rb"), "utf8"));
      const partial = join(out, "partial-sums");
      writeFileSync(partial, CHECKSUMS.split("\n").slice(1).join("\n"));
      const second = join(out, "second");
      const missing = spawnSync(process.execPath, [...args.slice(0, -2), second, "--checksums", partial], {
        cwd: ROOT,
        encoding: "utf8",
      });
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /no checksum for finitemonkey-1\.2\.3-darwin-x64\.tar\.gz/);
      assert.equal(existsSync(second), false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
