import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { REGISTRY } from "../src/commands/index.js";
import type { CommandSpec } from "../src/commands/types.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { FmError } from "../src/core/problem.js";
import { ExitCode, exitCodeDocs } from "../src/exit-codes.js";
import { cli, cliJson, fakeRuntime, field } from "./support.js";

const catalogDir = toAbsolutePath("/fixtures/catalogs");
const brokenCatalogs = fakeRuntime({
  files: {
    [join(catalogDir, "en.json")]: JSON.stringify({ a: "A {x}", b: "B" }),
    [join(catalogDir, "pt-BR.json")]: JSON.stringify({ a: "A {y}" }),
    [join(catalogDir, "es.json")]: JSON.stringify({ a: "A {x}", b: "B", c: "C" }),
  },
});

const throwing = (name: string, thrown: unknown): CommandSpec => ({
  path: [name],
  summaryKey: "command.help.summary",
  usage: `finitemonkey ${name}`,
  status: "ready",
  run: () => Promise.reject(thrown instanceof Error ? thrown : new Error(String(thrown))),
});

const extraRegistry = [
  ...REGISTRY,
  throwing("boom", new Error("kaput")),
  throwing(
    "noenv",
    new FmError({
      code: "i18n_catalog_unreadable",
      messageKey: "error.i18n_catalog_unreadable",
      params: { file: "x", detail: "y" },
      fix: "finitemonkey doctor",
      exitCode: ExitCode.Environment,
    }),
  ),
];

describe("exit codes", () => {
  it("documents every code", () => {
    for (const value of Object.values(ExitCode)) assert.ok(exitCodeDocs[value].length > 0);
  });

  const cases = [
    { argv: ["version"], exit: ExitCode.Ok, code: undefined },
    { argv: [], exit: ExitCode.Ok, code: undefined },
    { argv: ["frobnicate"], exit: ExitCode.Usage, code: "unknown_command" },
    { argv: ["doctor", "--nope"], exit: ExitCode.Usage, code: "invalid_arguments" },
    { argv: ["version", "extra"], exit: ExitCode.Usage, code: "unexpected_argument" },
    { argv: ["init"], exit: ExitCode.Usage, code: "not_implemented" },
    { argv: ["update", "--check"], exit: ExitCode.Usage, code: "not_implemented" },
    { argv: ["uninstall", "--purge"], exit: ExitCode.Usage, code: "not_implemented" },
    { argv: ["--lang", "klingon"], exit: ExitCode.Usage, code: "invalid_lang" },
    { argv: ["hook", "PreLunch"], exit: ExitCode.Usage, code: "unknown_hook_event" },
    { argv: ["i18n", "check", "--dir", catalogDir], exit: ExitCode.CheckFailed, code: "i18n_mismatch" },
    { argv: ["i18n", "check", "--dir", "/nowhere"], exit: ExitCode.Environment, code: "i18n_catalog_unreadable" },
    { argv: ["noenv"], exit: ExitCode.Environment, code: "i18n_catalog_unreadable" },
    { argv: ["boom"], exit: ExitCode.Internal, code: "internal_error" },
  ] as const;

  for (const { argv, exit, code } of cases) {
    it(`${argv.join(" ") || "(no arguments)"} exits ${String(exit)}${code === undefined ? "" : ` with ${code}`}`, async () => {
      const result = await cliJson(argv, { registry: extraRegistry, runtime: brokenCatalogs });
      assert.equal(result.code, exit);
      assert.equal(field(result.body, "ok"), exit === ExitCode.Ok);
      assert.equal(field(result.body, "error", "code"), code);
      if (code !== undefined) assert.notEqual(field(result.body, "error", "fix"), "");
    });
  }

  it("internal errors carry the detail and point to the issue tracker", async () => {
    const { body } = await cliJson(["boom"], { registry: extraRegistry });
    assert.match(String(field(body, "error", "message")), /kaput/);
    assert.match(String(field(body, "error", "fix")), /github\.com\/gabrielvieiraf\/finitemonkey\/issues/);
  });

  it("human errors go to stderr with the fix and leave stdout clean", async () => {
    const { stdout, stderr } = await cli(["frobnicate"]);
    assert.equal(stdout, "");
    assert.match(stderr, /frobnicate/);
    assert.match(stderr, /fix: finitemonkey help/);
  });
});
