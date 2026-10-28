import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { checkGithubRules, invalidCodeownersLines } from "../src/doctor/github.js";
import { cli, cliJson, fakeRuntime, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const at = (path: string): string => toAbsolutePath(path, ROOT);

const remote = (url: string) => (args: readonly string[]) =>
  args.join(" ") === "remote get-url origin" ? { found: true, ok: true, stdout: `${url}\n` } : undefined;

const gitWith = (url: string) => (args: readonly string[]) =>
  remote(url)(args) ?? { found: true, ok: false, stdout: "" };

const firstEntry = (body: unknown): unknown => {
  const list = field(body, "data", "entries");
  return Array.isArray(list) ? (list[0] as unknown) : undefined;
};

const read = (runtime: ReturnType<typeof fakeRuntime>, path: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(at(path)));
  return text.ok ? text.value : undefined;
};

describe("gen pr-template", () => {
  for (const [lang, heading] of [
    ["en", "## What changes"],
    ["pt-BR", "## O que muda"],
    ["es", "## Qué cambia"],
  ] as const) {
    it(`writes the template in ${lang} with the sections and checklist`, async () => {
      const runtime = fakeRuntime({ files: { [at(".finitemonkey/config.yml")]: `lang: ${lang}\n` } });
      const run = await cli(["gen", "pr-template", "--yes"], { runtime, cwd: ROOT });
      assert.equal(run.code, 0, run.stdout);
      const text = read(runtime, ".github/pull_request_template.md") ?? "";
      assert.match(text, new RegExp(heading));
      assert.equal((text.match(/^## /gm) ?? []).length, 7);
      assert.match(text, /Closes #/);
      assert.match(text, /- \[ \] `finitemonkey gate`/);
    });
  }

  it("shows an existing template as a diff and never overwrites it", async () => {
    const mine = "## Summary\n";
    const runtime = fakeRuntime({ files: { [at(".github/PULL_REQUEST_TEMPLATE.md")]: mine } });
    const run = await cliJson(["gen", "pr-template", "--yes"], { runtime, cwd: ROOT });
    assert.equal(run.code, 0);
    assert.equal(field(firstEntry(run.body), "status"), "differs");
    assert.match(JSON.stringify(field(run.body, "data", "entries")), /- ## Summary/);
    assert.equal(read(runtime, ".github/PULL_REQUEST_TEMPLATE.md"), mine);
    assert.equal(read(runtime, ".github/pull_request_template.md"), undefined);
  });
});

describe("gen codeowners", () => {
  it("owns the contract, workflows, infra, migrations and itself, and doctor accepts it", async () => {
    const runtime = fakeRuntime({
      files: { [at("src/api/endpoints.ts")]: "", [at("prisma/migrations/1/migration.sql")]: "" },
      git: gitWith("git@github.com:acme/app.git"),
    });
    const run = await cli(["gen", "codeowners", "--owner", "@acme/core", "--yes"], { runtime, cwd: ROOT });
    assert.equal(run.code, 0, run.stdout);
    const text = read(runtime, ".github/CODEOWNERS") ?? "";
    for (const path of ["/src/api/", "/.github/workflows/", "/infra/", "/prisma/migrations/", "/.github/CODEOWNERS"]) {
      assert.match(text, new RegExp(`^${path.replace(/[.*/]/g, "\\$&")}\\s+@acme/core$`, "m"));
    }
    assert.deepEqual(invalidCodeownersLines(text), []);
    const findings = checkGithubRules({ platform: "linux", env: {}, cwd: ROOT, root: ROOT, version: "1.0.0", runtime });
    assert.ok(findings.some((item) => item.messageKey === "doctor.github.codeowners_ok"));
  });

  it("takes the owner from the origin remote and refuses an invalid one", async () => {
    const runtime = fakeRuntime({ git: gitWith("https://github.com/ana/app.git") });
    const run = await cliJson(["gen", "codeowners"], { runtime, cwd: ROOT });
    assert.match(JSON.stringify(field(run.body, "data", "entries")), /@ana/);
    const bad = await cli(["gen", "codeowners", "--owner", "not-an-owner", "--yes"], { runtime, cwd: ROOT });
    assert.equal(bad.code, 2);
    const none = await cli(["gen", "codeowners", "--yes"], { runtime: fakeRuntime(), cwd: ROOT });
    assert.equal(none.code, 2);
  });

  it("shows an existing CODEOWNERS as a diff and never overwrites it", async () => {
    const mine = "* @acme/everyone\n";
    const runtime = fakeRuntime({ files: { [at("CODEOWNERS")]: mine } });
    const run = await cliJson(["gen", "codeowners", "--owner", "@acme/core", "--yes"], { runtime, cwd: ROOT });
    assert.equal(field(firstEntry(run.body), "path"), "CODEOWNERS");
    assert.equal(field(firstEntry(run.body), "status"), "differs");
    assert.equal(read(runtime, "CODEOWNERS"), mine);
  });
});
