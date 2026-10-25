import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { REGISTRY } from "../src/commands/index.js";
import type { CommandSpec } from "../src/commands/types.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { FmError, needsPersonProblem } from "../src/core/problem.js";
import { failureFrom } from "../src/core/result.js";
import { EXIT_CODE_NAMES, ExitCode, exitCodeDocs } from "../src/exit-codes.js";
import { LANGUAGES } from "../src/i18n/languages.js";
import { createTranslator } from "../src/i18n/translate.js";
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

const asking: CommandSpec = {
  path: ["ask"],
  summaryKey: "command.help.summary",
  usage: "finitemonkey ask",
  status: "ready",
  run: (ctx) =>
    Promise.resolve(
      failureFrom(
        ctx.t,
        needsPersonProblem("error.needs_confirmation", "finitemonkey ask --yes", {
          command: "ask",
          question: "overwrite?",
        }),
      ),
    ),
};

const extraRegistry = [
  ...REGISTRY,
  asking,
  throwing("boom", new Error("kaput")),
  throwing(
    "noenv",
    new FmError({
      code: "i18n_catalog_unreadable",
      messageKey: "error.i18n_catalog_unreadable",
      params: { file: "x", detail: "y" },
      fix: "finitemonkey doctor",
      exitCode: ExitCode.NotConfigured,
    }),
  ),
];

describe("exit codes", () => {
  it("names every code once, in order", () => {
    assert.deepEqual(EXIT_CODE_NAMES, Object.keys(ExitCode));
    assert.deepEqual(
      EXIT_CODE_NAMES.map((name) => ExitCode[name]),
      [0, 1, 2, 3, 4, 5],
    );
  });

  for (const lang of LANGUAGES) {
    it(`help documents every exit code in ${lang}`, async () => {
      const t = createTranslator(lang);
      const { stdout } = await cli(["help", "--lang", lang]);
      for (const value of Object.values(ExitCode)) assert.ok(stdout.includes(t(exitCodeDocs[value])), String(value));
    });
  }

  const cases = [
    { argv: ["version"], exit: ExitCode.Ok, code: undefined },
    { argv: [], exit: ExitCode.Ok, code: undefined },
    { argv: ["frobnicate"], exit: ExitCode.Usage, code: "unknown_command" },
    { argv: ["doctor", "--nope"], exit: ExitCode.Usage, code: "invalid_arguments" },
    { argv: ["version", "extra"], exit: ExitCode.Usage, code: "unexpected_argument" },
    { argv: ["init"], exit: ExitCode.NeedsPerson, code: "needs_confirmation" },
    { argv: ["init", "--dry-run"], exit: ExitCode.Ok, code: undefined },
    { argv: ["init", "--preset", "loud"], exit: ExitCode.Usage, code: "invalid_arguments" },
    { argv: ["update", "--check"], exit: ExitCode.NotConfigured, code: "not_installed" },
    { argv: ["uninstall", "--purge"], exit: ExitCode.NotConfigured, code: "not_installed" },
    { argv: ["--lang", "klingon"], exit: ExitCode.Usage, code: "invalid_lang" },
    { argv: ["hook", "PreLunch"], exit: ExitCode.Usage, code: "unknown_hook_event" },
    { argv: ["i18n", "check", "--dir", catalogDir], exit: ExitCode.CheckFailed, code: "i18n_mismatch" },
    { argv: ["i18n", "check", "--dir", "/nowhere"], exit: ExitCode.NotConfigured, code: "i18n_catalog_unreadable" },
    { argv: ["noenv"], exit: ExitCode.NotConfigured, code: "i18n_catalog_unreadable" },
    { argv: ["ask"], exit: ExitCode.NeedsPerson, code: "needs_confirmation" },
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
