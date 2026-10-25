import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { accept } from "../src/core/parsed.js";
import type { Runtime } from "../src/core/runtime.js";
import { scanText } from "../src/secrets/engine.js";
import { scanHistory, scanPath, scanStaged } from "../src/secrets/scan.js";
import { SAMPLES } from "./secret-samples.js";
import { fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");

const crlf = (lines: readonly string[]): string => lines.map((line) => `${line}\r`).join("\n");

const diffLines = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -0,0 +1,2 @@",
  "+const ok = 1;",
  `+const t = "${SAMPLES.githubPat}";`,
] as const;

const summary = (
  findings: readonly { readonly ruleId: string; readonly file: string; readonly line: number }[],
): readonly string[] => findings.map((item) => `${item.ruleId} ${item.file}:${String(item.line)}`);

describe("secrets on Windows: backslash paths and CRLF git output", () => {
  it("a walk that returns backslash paths still finds the secret and reports a POSIX path", () => {
    const base = fakeRuntime({ files: { [`${ROOT}\\src\\a.ts`]: `const t = "${SAMPLES.githubPat}";\r\n` } });
    const runtime: Runtime = { ...base, walkFiles: () => accept(["src\\a.ts"]) };
    const found = scanPath(runtime, ROOT, ".");
    assert.ok(found.ok);
    assert.deepEqual(summary(found.value), ["github-pat src/a.ts:1"]);
  });

  it("git ls-files output with backslashes is normalized", () => {
    const runtime = fakeRuntime({
      files: { [`${ROOT}/src/a.ts`]: `const t = "${SAMPLES.npmToken}";\n` },
      git: (args) => ({ found: true, ok: args[0] === "ls-files", stdout: "src\\a.ts\u0000" }),
    });
    const found = scanPath(runtime, ROOT, ".");
    assert.ok(found.ok);
    assert.deepEqual(summary(found.value), ["npm-access-token src/a.ts:1"]);
  });

  it("a CRLF staged diff keeps file and line numbers", () => {
    const runtime = fakeRuntime({ git: () => ({ found: true, ok: true, stdout: crlf(diffLines) }) });
    const found = scanStaged(runtime, ROOT);
    assert.ok(found.ok);
    assert.deepEqual(summary(found.value), ["github-pat src/a.ts:2"]);
  });

  it("a CRLF history stream keeps the commit, file and line", async () => {
    const lines = ["commit 1111111111111111111111111111111111111111", ...diffLines].map((line) => `${line}\r`);
    const found = await scanHistory(fakeRuntime({ gitLines: () => lines }), ROOT);
    assert.ok(found.ok);
    assert.deepEqual(summary(found.value), ["github-pat src/a.ts:2"]);
    assert.equal(found.value[0]?.commit, "1111111111111111111111111111111111111111");
  });

  it("test and lockfile paths with backslashes skip the generic rules", () => {
    const generic = `const apiKey = "${SAMPLES.genericValue}";`;
    assert.deepEqual(scanText(generic, { path: "test\\fixtures\\config.ts" }), []);
    assert.deepEqual(scanText(generic, { path: "apps\\web\\package-lock.json" }), []);
  });

  it("the fake file system treats both separators as the same file", () => {
    const runtime = fakeRuntime();
    runtime.writeText(toAbsolutePath(`${ROOT}\\.finitemonkey\\incidents\\x.json`), "{}");
    assert.ok(runtime.readText(toAbsolutePath(`${ROOT}/.finitemonkey/incidents/x.json`)).ok);
    const listed = runtime.listDir(toAbsolutePath(`${ROOT}\\.finitemonkey\\incidents`));
    assert.ok(listed.ok);
    assert.deepEqual(listed.value, ["x.json"]);
  });
});
