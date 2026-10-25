import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REGISTRY } from "../src/commands/index.js";
import type { CommandSpec } from "../src/commands/types.js";
import { type CommandResult, success } from "../src/core/result.js";
import { ExitCode } from "../src/exit-codes.js";
import { maskDeep, maskText } from "../src/mask/mask.js";
import { SAMPLES } from "./secret-samples.js";
import { cli, stdinFrom } from "./support.js";

const PLANTED = [SAMPLES.githubPat, SAMPLES.awsAccessKey, SAMPLES.anthropic, SAMPLES.privateKey, SAMPLES.jwt] as const;

const leaks = (text: string): readonly string[] => PLANTED.filter((secret) => text.includes(secret));

const canary = (mode: "human" | "error" | "raw"): CommandSpec => ({
  path: ["canary"],
  summaryKey: "command.version.summary",
  usage: "finitemonkey canary",
  status: "ready",
  run: (): Promise<CommandResult> => {
    const text = PLANTED.join("\n");
    const data = { nested: { list: [...PLANTED], [SAMPLES.githubPat]: "key" } };
    if (mode === "raw") {
      return Promise.resolve({ ok: true, exitCode: ExitCode.Ok, data, raw: { stdout: text, stderr: text } });
    }
    if (mode === "human") return Promise.resolve({ ...success(data, [text]), next: SAMPLES.githubPat });
    return Promise.resolve({
      ok: false,
      exitCode: ExitCode.CheckFailed,
      data,
      human: [text],
      error: { code: "internal_error", message: text, fix: `export TOKEN=${SAMPLES.githubPat}` },
    });
  },
});

describe("masker", () => {
  it("replaces each secret with «secret:rule-id:last4»", () => {
    const masked = maskText(`token=${SAMPLES.githubPat} and ${SAMPLES.awsAccessKey}`);
    assert.equal(
      masked,
      `token=«secret:github-pat:${SAMPLES.githubPat.slice(-4)}» and «secret:aws-access-token:${SAMPLES.awsAccessKey.slice(-4)}»`,
    );
  });

  it("leaves text without secrets untouched, placeholders included", () => {
    const text = "ASAAS_API_KEY=$aact_YOUR_KEY_HERE\nnothing here";
    assert.equal(maskText(text), text);
  });

  it("masks keys and values deep inside JSON-like data", () => {
    const masked = JSON.stringify(maskDeep({ a: [SAMPLES.npmToken, 3, null], [SAMPLES.gcp]: { b: SAMPLES.jwt } }));
    assert.deepEqual(leaks(masked), []);
    assert.ok(!masked.includes(SAMPLES.npmToken) && !masked.includes(SAMPLES.gcp));
    assert.match(masked, /«secret:npm-access-token:/);
  });
});

describe("every CLI printer goes through the masker", () => {
  const modes = ["human", "error", "raw"] as const;
  for (const mode of modes) {
    for (const json of [false, true]) {
      it(`a planted secret never reaches stdout or stderr (${mode}${json ? ", --json" : ""})`, async () => {
        const registry = [...REGISTRY, canary(mode)];
        const run = await cli(json ? ["canary", "--json"] : ["canary"], { registry });
        assert.deepEqual(leaks(run.stdout), []);
        assert.deepEqual(leaks(run.stderr), []);
        assert.match(`${run.stdout}${run.stderr}`, /«secret:github-pat:/);
        if (json && mode !== "raw") assert.doesNotThrow(() => JSON.parse(run.stdout) as unknown);
      });
    }
  }

  it("a blocked hook names the rule and never echoes the value", async () => {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/home/ana/project/src/config.ts", content: `export const t = "${SAMPLES.githubPat}";` },
    });
    const run = await cli(["hook", "PreToolUse"], { stdin: stdinFrom(payload) });
    assert.equal(run.code, 2);
    assert.match(run.stderr, /github-pat/);
    assert.deepEqual(leaks(`${run.stdout}${run.stderr}`), []);
  });
});
