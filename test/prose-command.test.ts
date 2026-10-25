import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { isRecord } from "../src/core/parsed.js";
import type { GitResult } from "../src/core/runtime.js";
import { proseGateStatus } from "../src/prose/gate.js";
import { cli, cliJson, fakeRuntime, field, gitMissing, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const BAD = "You know the routine. That is not a character flaw. It is the pace of the work.\n";
const GOOD = "Claude Code ended a refactor with a green summary. It had only run the linter.\n";
const frozen: unknown = JSON.parse(readFileSync(new URL("fixtures/contract-v1.json", import.meta.url), "utf8"));

const items = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const required = (shape: string): readonly string[] => {
  const shapeOf: unknown = field(frozen, shape, "required");
  return isRecord(shapeOf) ? Object.keys(shapeOf) : [];
};

const files = {
  [`${ROOT}/README.md`]: BAD,
  [`${ROOT}/docs/guide.md`]: GOOD,
  [`${ROOT}/docs/notes.txt`]: GOOD,
  [`${ROOT}/docs/image.png`]: "png",
  [`${ROOT}/CHANGELOG.md`]: "## 1.0.0\n\n- docs: introdução do readme com o texto do gabriel\n",
};

const changed = (args: readonly string[]): GitResult => {
  if (args[0] === "diff") return { found: true, ok: true, stdout: "README.md\u0000src/a.ts\u0000" };
  if (args[0] === "ls-files") return { found: true, ok: true, stdout: "docs/guide.md\u0000" };
  return gitMissing;
};

describe("finitemonkey prose check", () => {
  it("flags a file with exit 1 and keeps the JSON contract", async () => {
    const run = await cliJson(["prose", "check", "README.md"], { runtime: fakeRuntime({ files }), cwd: ROOT });
    assert.equal(run.code, 1);
    assert.equal(field(run.body, "error", "code"), "prose_found");
    const data = field(run.body, "data");
    assert.equal(field(data, "schema"), field(frozen, "proseCheck", "schema"));
    for (const key of required("proseCheck")) assert.ok(key in Object(data), key);
    const [file] = items(field(data, "files"));
    for (const key of required("proseFile")) assert.ok(key in Object(file), key);
    const [span] = items(field(file, "spans"));
    for (const key of required("proseSpan")) assert.ok(key in Object(span), key);
    assert.equal(field(span, "startLine"), 1);
  });

  it("walks a directory, reads only text files and passes clean ones", async () => {
    const run = await cliJson(["prose", "check", "docs"], { runtime: fakeRuntime({ files }), cwd: ROOT });
    assert.equal(run.code, 0);
    assert.deepEqual(field(run.body, "data", "summary"), { files: 2, flagged: 0, spans: 0 });
  });

  it("reads --stdin and prints the do-instead in the person's language", async () => {
    const run = await cli(["prose", "check", "--stdin", "--lang", "pt-BR"], { stdin: stdinFrom(BAD), cwd: ROOT });
    assert.equal(run.code, 1);
    assert.match(run.stdout, /<stdin>:1-1 pontos \d+: opener-routine "You know the routine"/);
    assert.match(run.stdout, /faça no lugar: opener-routine: abra com o que aconteceu/);
  });

  it("--record applies the commit rules, and CHANGELOG files get them by default", async () => {
    const stdin = stdinFrom("docs: badges no estilo do julius2claude\n");
    assert.equal((await cli(["prose", "check", "--stdin"], { stdin, cwd: ROOT })).code, 0);
    const recorded = await cli(["prose", "check", "--stdin", "--record"], {
      stdin: stdinFrom("docs: badges no estilo do julius2claude\n"),
      cwd: ROOT,
    });
    assert.equal(recorded.code, 1);
    const changelog = await cli(["prose", "check", "CHANGELOG.md"], { runtime: fakeRuntime({ files }), cwd: ROOT });
    assert.match(changelog.stdout, /person-as-reason/);
  });

  it("without paths it checks the changed Markdown files", async () => {
    const runtime = fakeRuntime({ files, git: changed });
    const run = await cliJson(["prose", "check"], { runtime, cwd: ROOT });
    assert.deepEqual(field(run.body, "data", "summary"), { files: 2, flagged: 1, spans: 1 });
  });

  it("without paths and without git it says what to pass", async () => {
    const run = await cliJson(["prose", "check"], { cwd: ROOT });
    assert.equal(run.code, 2);
    assert.equal(field(run.body, "error", "code"), "prose_no_input");
  });

  it("a missing path is a usage error, not a pass", async () => {
    const run = await cliJson(["prose", "check", "nope.md"], { cwd: ROOT });
    assert.equal(field(run.body, "error", "code"), "prose_unreadable");
  });
});

describe("proseGateStatus for the Stop gate", () => {
  it("lists flagged changed Markdown and blocks only in the gabriel preset", () => {
    const neutral = proseGateStatus(fakeRuntime({ files, git: changed }), ROOT);
    assert.ok(neutral.ok);
    assert.deepEqual(
      neutral.value.flagged.map((item) => item.file),
      ["README.md"],
    );
    assert.equal(neutral.value.blocking, false);
    const config = { [`${ROOT}/.finitemonkey/config.yml`]: "preset: gabriel\n" };
    const gabriel = proseGateStatus(fakeRuntime({ files: { ...files, ...config }, git: changed }), ROOT);
    assert.ok(gabriel.ok && gabriel.value.blocking);
  });

  it("without git it reports an error instead of passing", () => {
    assert.equal(proseGateStatus(fakeRuntime({ files }), ROOT).ok, false);
  });
});
