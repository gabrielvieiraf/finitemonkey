import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { type CliConfig, cliFindings, type CliRun, type CliRuns, median } from "../src/cliux/cli.js";
import { probeCli } from "../src/cliux/run.js";
import { helpFor } from "../src/commands/help.js";
import { examplesOf } from "../src/commands/help-examples.js";
import { REGISTRY } from "../src/commands/index.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { ExecRequest, ExecResult } from "../src/core/runtime.js";
import { createTranslator } from "../src/i18n/translate.js";
import { BUNDLE, execResult, fakeCtx, ROOT } from "./support.js";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

const kinds = (items: readonly { readonly kind: string }[]): readonly string[] => items.map((item) => item.kind);

const run = (args: readonly string[], fields: Partial<CliRun> = {}): CliRun => ({
  args,
  found: true,
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  durationMs: 20,
  ...fields,
});

const runs = (fields: Partial<CliRuns> = {}): CliRuns => ({
  help: run(["--help"], { stdout: "Usage: x\n\nExamples:\n  $ x build\n" }),
  errors: [],
  json: [],
  destructive: [],
  timings: [20, 20, 20],
  ...fields,
});

describe("cli conventions", () => {
  it("passes a CLI that follows the conventions", () => {
    const clean = runs({
      errors: [run(["bogus"], { exitCode: 2, stderr: "error: unknown command" })],
      json: [run(["status", "--json"], { stdout: '{"ok":true}' })],
      destructive: [run(["rm", "--help"], { stdout: "Usage: x rm <name> [--force]" })],
    });
    assert.deepEqual(cliFindings(clean, 100), []);
  });

  it("reports NO_COLOR ignored, a prompt without a TTY, a hang, an unguarded destructive command and slow output", () => {
    const bad = runs({
      help: run(["--help"], { stdout: "\u001b[1mUsage\u001b[0m: x" }),
      json: [run(["status", "--json"], { stdout: "Done!" }), run(["wait", "--json"], { stdout: "{}", timedOut: true })],
      destructive: [run(["rm", "--help"], { stdout: "Usage: x rm <name>\nContinue? [y/N]" })],
      timings: [90, 150, 160],
    });
    assert.deepEqual(kinds(cliFindings(bad, 100)), [
      "help_no_example",
      "json_invalid",
      "ansi_with_no_color",
      "prompt_without_tty",
      "timed_out",
      "destructive_unguarded",
      "slow_first_output",
    ]);
    assert.equal(median([90, 150, 160, 10]), 120);
  });

  it("a fixture that prints errors to stdout and exits 0 yields both findings", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-cli-"));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const script = join(dir, "bad-cli.mjs");
    writeFileSync(
      script,
      [
        "const [command] = process.argv.slice(2);",
        "if (command === '--help') { console.log('Usage: bad <command>\\n\\nExamples:\\n  $ bad build'); }",
        "else { console.log(process.env.NO_COLOR ? 'error: unknown command' : '\\u001b[31merror\\u001b[0m'); }",
        "process.exit(0);",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    const config: CliConfig = {
      bin: ["node", script.replace(/\\/g, "/")],
      errors: [["bogus"]],
      json: [],
      destructive: [],
      firstOutputMs: 60_000,
      runs: 1,
      timeoutMs: 60_000,
    };
    const probed = probeCli(nodeRuntime(), toAbsolutePath(dir), config);
    assert.ok(probed !== undefined);
    assert.deepEqual(kinds(cliFindings(probed, config.firstOutputMs)), ["error_exit_zero", "error_on_stdout"]);
  });

  it("runs on the project's own CLI: errors on stderr with a non-zero exit, valid --json, no color under NO_COLOR", () => {
    const config: CliConfig = {
      bin: ["node", BUNDLE.replace(/\\/g, "/")],
      errors: [["no-such-command"]],
      json: [["version", "--json"]],
      destructive: [],
      firstOutputMs: 60_000,
      runs: 1,
      timeoutMs: 60_000,
    };
    const probed = probeCli(nodeRuntime(), ROOT, config);
    assert.ok(probed !== undefined);
    const found = kinds(cliFindings(probed, config.firstOutputMs, config.timeoutMs));
    for (const kind of [
      "help_no_example",
      "error_exit_zero",
      "error_on_stdout",
      "json_invalid",
      "ansi_with_no_color",
      "prompt_without_tty",
    ])
      assert.ok(!found.includes(kind), kind);
  });

  it("every command's help shows an Examples section that the CLI check accepts, in every language", () => {
    for (const lang of ["en", "pt-BR", "es"] as const) {
      const ctx = fakeCtx({ lang, t: createTranslator(lang) });
      for (const spec of REGISTRY) {
        const help = (helpFor(ctx, spec).human ?? []).join("\n");
        const probed = runs({ help: run([...spec.path, "--help"], { stdout: help }) });
        assert.deepEqual(kinds(cliFindings(probed, 100)), [], `${lang} ${spec.path.join(" ")}`);
      }
    }
  });
});

describe("help examples", () => {
  it("derives a runnable example from the usage line, plus one with --json when offered", () => {
    assert.deepEqual(
      examplesOf({ usage: "finitemonkey decide accept <record> [--choice <what>] [--reason <one line>]" }),
      ["finitemonkey decide accept <record>"],
    );
    assert.deepEqual(examplesOf({ usage: "finitemonkey deploy plan [--level <0-3> [--decision <file>]] [--json]" }), [
      "finitemonkey deploy plan",
      "finitemonkey deploy plan --json",
    ]);
    assert.deepEqual(
      examplesOf({ usage: "finitemonkey critique verify [--base <ref>] (or the findings JSON on stdin)" }),
      ["finitemonkey critique verify"],
    );
    assert.deepEqual(examplesOf({ usage: "finitemonkey x", examples: ["finitemonkey x run"] }), ["finitemonkey x run"]);
  });
});

describe("time to first output", () => {
  it("measures the help timing at the first byte, not the total run", () => {
    const requests: ExecRequest[] = [];
    const runtime = {
      exec: (request: ExecRequest): ExecResult => {
        requests.push(request);
        return { ...execResult(0, "Usage: slow\n\nExamples:\n  $ slow go\n"), durationMs: 5000, firstOutputMs: 2000 };
      },
    };
    const config: CliConfig = {
      bin: ["slow"],
      errors: [],
      json: [],
      destructive: [],
      firstOutputMs: 100,
      runs: 3,
      timeoutMs: 60_000,
    };
    const probed = probeCli(runtime, toAbsolutePath("/p"), config);
    assert.ok(probed !== undefined);
    assert.deepEqual(probed.timings, [2000, 2000, 2000]);
    assert.ok(requests.every((request) => request.firstByte === true));
    assert.deepEqual(cliFindings(probed, config.firstOutputMs), [
      { kind: "slow_first_output", median: 2000, limit: 100 },
    ]);
  });

  it("a real CLI that prints its first line after 2 s is measured at that first byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-cli-first-"));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const script = join(dir, "late-cli.mjs");
    writeFileSync(
      script,
      [
        "setTimeout(() => {",
        "  process.stdout.write('Usage: late\\n');",
        "  setTimeout(() => { process.stdout.write('Examples:\\n  $ late go\\n'); }, 800);",
        "}, 2000);",
      ].join("\n"),
    );
    const result = nodeRuntime().exec({
      command: process.execPath,
      args: [script],
      cwd: toAbsolutePath(dir),
      timeoutMs: 60_000,
      input: "",
      firstByte: true,
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: late\n[\s\S]*\$ late go/);
    const first = result.firstOutputMs ?? -1;
    assert.ok(first >= 1900, `first byte at ${String(first)} ms`);
    assert.ok(result.durationMs - first >= 500, `first ${String(first)} ms, total ${String(result.durationMs)} ms`);
  });
});
