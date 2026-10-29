import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { type CliConfig, cliFindings, type CliRun, type CliRuns, median } from "../src/cliux/cli.js";
import { probeCli } from "../src/cliux/run.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { BUNDLE, ROOT } from "./support.js";

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
    assert.ok(found.includes("help_no_example"));
    for (const kind of [
      "error_exit_zero",
      "error_on_stdout",
      "json_invalid",
      "ansi_with_no_color",
      "prompt_without_tty",
    ])
      assert.ok(!found.includes(kind), kind);
  });
});
