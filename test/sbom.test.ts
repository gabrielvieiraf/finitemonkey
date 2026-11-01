import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { buildSbom, hashes, licenses, purl, serialNumber } from "../scripts/sbom-lib.js";
import { parseLockfile } from "../scripts/sbom-lock.js";
import { validateSbom } from "../scripts/sbom-validate.js";
import { ROOT } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures", "sbom");
const TIMESTAMP = "2026-01-01T00:00:00Z";
const fixtureLock = () => readFileSync(join(FIXTURES, "package-lock.json"), "utf8");

describe("sbom", () => {
  it("turns the fixture lockfile into the expected CycloneDX 1.5 document", () => {
    const result = buildSbom(parseLockfile(fixtureLock()), TIMESTAMP, "2.0.0");
    assert.deepEqual(result.problems, []);
    assert.ok(result.bom);
    assert.deepEqual(validateSbom(result.bom), []);
    assert.equal(`${JSON.stringify(result.bom, null, 2)}\n`, readFileSync(join(FIXTURES, "expected.cdx.json"), "utf8"));
  });

  it("marks dev packages excluded, optional ones optional, and resolves nested copies", () => {
    const result = buildSbom(parseLockfile(fixtureLock()), TIMESTAMP, "2.0.0");
    const scopes = Object.fromEntries((result.bom?.components ?? []).map((item) => [item.purl, item.scope]));
    assert.equal(scopes["pkg:npm/tester@3.1.0"], "excluded");
    assert.equal(scopes["pkg:npm/watcher@1.0.0"], "optional");
    const leftPad = result.bom?.dependencies.find((item) => item.ref === "pkg:npm/left-pad@1.3.0");
    assert.deepEqual(leftPad?.dependsOn, ["pkg:npm/%40scope/util@1.0.0"]);
  });

  it("is reproducible for the same lockfile and timestamp", () => {
    const first = buildSbom(parseLockfile(fixtureLock()), TIMESTAMP, "2.0.0");
    const second = buildSbom(parseLockfile(fixtureLock()), TIMESTAMP, "2.0.0");
    assert.deepEqual(first, second);
  });

  it("covers the repository lockfile without an unresolved dependency", () => {
    const result = buildSbom(parseLockfile(readFileSync(join(ROOT, "package-lock.json"), "utf8")), TIMESTAMP, "0.0.0");
    assert.deepEqual(result.problems, []);
    assert.ok(result.bom);
    assert.deepEqual(validateSbom(result.bom), []);
    assert.ok(result.bom.components.some((item) => item.name === "esbuild"));
  });

  it("fails closed when a required dependency is missing from the lockfile", () => {
    const lock: unknown = JSON.parse(fixtureLock());
    const packages: unknown = Reflect.get(lock as object, "packages");
    Reflect.deleteProperty(packages as object, "node_modules/left-pad/node_modules/@scope/util");
    Reflect.deleteProperty(packages as object, "node_modules/@scope/util");
    const result = buildSbom(parseLockfile(JSON.stringify(lock)), TIMESTAMP, "2.0.0");
    assert.equal(result.bom, undefined);
    assert.ok(result.problems.some((problem) => problem.includes("needs @scope/util")));
  });

  it("refuses a lockfile version 1", () => {
    assert.throws(() => parseLockfile(JSON.stringify({ lockfileVersion: 1, dependencies: {} })), /lockfileVersion/);
  });

  it("encodes scoped purls, converts integrity to hex and keeps license expressions", () => {
    assert.equal(purl("@scope/util", "1.0.0+build"), "pkg:npm/%40scope/util@1.0.0%2Bbuild");
    assert.deepEqual(hashes("sha256-AAAA bogus-xx"), [{ alg: "SHA-256", content: "000000" }]);
    assert.deepEqual(licenses("MIT OR ISC"), [{ expression: "MIT OR ISC" }]);
    assert.deepEqual(licenses("UNLICENSED custom"), [{ license: { name: "UNLICENSED custom" } }]);
    assert.match(
      serialNumber("seed"),
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("the validator reports a dangling dependency and a malformed hash", () => {
    const result = buildSbom(parseLockfile(fixtureLock()), TIMESTAMP, "2.0.0");
    assert.ok(result.bom);
    const [first, ...rest] = result.bom.components;
    assert.ok(first);
    const broken = {
      ...result.bom,
      components: [{ ...first, hashes: [{ alg: "SHA-512", content: "abc" }] }, ...rest],
      dependencies: [...result.bom.dependencies, { ref: "pkg:npm/ghost@1.0.0", dependsOn: [] }],
    };
    const problems = validateSbom(broken);
    assert.ok(problems.some((problem) => problem.includes("hash is malformed")));
    assert.ok(problems.some((problem) => problem.includes("ghost")));
  });
});
