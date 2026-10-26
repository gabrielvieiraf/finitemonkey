import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isRecord } from "../src/core/parsed.js";
import { scanText } from "../src/secrets/engine.js";
import { NEGATIVES, POSITIVES } from "./secret-corpus.js";

const MIRRORED = new Set([
  "aws-access-token",
  "github-pat",
  "github-oauth",
  "github-app-token",
  "github-refresh-token",
  "github-fine-grained-pat",
  "gitlab-pat",
  "npm-access-token",
  "slack-bot-token",
  "slack-user-token",
  "slack-app-token",
  "slack-webhook-url",
  "stripe-access-token",
  "anthropic-api-key",
  "openai-api-key",
  "gcp-api-key",
  "private-key",
  "jwt",
  "generic-api-key",
]);

const ALIASES: Readonly<Record<string, string>> = { "anthropic-admin-api-key": "anthropic-api-key" };

const KNOWN_DIFFERENCES: ReadonlyMap<string, string> = new Map([
  [
    "positive 1 (aws-secret-access-key): generic-api-key only gitleaks",
    "gitleaks has no AWS secret rule and reports it as generic; Finite Monkey reports aws-secret-access-key",
  ],
  [
    "positive 15 (openai-api-key): openai-api-key only Finite Monkey",
    "the Finite Monkey rule also covers sk-proj- keys; gitleaks matches only the older layout",
  ],
  [
    "positive 15 (openai-api-key): generic-api-key only gitleaks",
    "same key as above, reported by the gitleaks generic rule",
  ],
  ["negative Stripe test key: stripe-access-token only gitleaks", "Finite Monkey flags only live Stripe keys"],
]);

interface Case {
  readonly id: string;
  readonly text: string;
}

const CASES: readonly Case[] = [
  ...POSITIVES.map(({ rule, text }, index) => ({ id: `positive ${String(index)} (${rule})`, text })),
  ...NEGATIVES.map(({ name, text }) => ({ id: `negative ${name}`, text })),
];

const fileOf = (index: number): string => `case-${String(index).padStart(3, "0")}.txt`;

const gitleaksFindings = (dir: string, report: string): ReadonlyMap<string, ReadonlySet<string>> => {
  const run = spawnSync(
    "gitleaks",
    ["dir", dir, "--report-format", "json", "--report-path", report, "--exit-code", "0", "--no-banner"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const parsed: unknown = JSON.parse(readFileSync(report, "utf8"));
  const found = new Map<string, Set<string>>();
  for (const item of Array.isArray(parsed) ? parsed : []) {
    if (!isRecord(item)) continue;
    const file = String(item["File"]).split(/[\\/]/).at(-1) ?? "";
    const rule = String(item["RuleID"]);
    found.set(file, new Set([...(found.get(file) ?? []), ALIASES[rule] ?? rule]));
  }
  return found;
};

const divergences = (found: ReadonlyMap<string, ReadonlySet<string>>): readonly string[] =>
  CASES.flatMap((item, index) => {
    const ours = new Set(
      scanText(item.text)
        .map((finding) => finding.ruleId)
        .filter((id) => MIRRORED.has(id)),
    );
    const theirs = new Set([...(found.get(fileOf(index)) ?? [])].filter((id) => MIRRORED.has(id)));
    return [...MIRRORED]
      .filter((rule) => ours.has(rule) !== theirs.has(rule))
      .map((rule) => `${item.id}: ${rule} ${ours.has(rule) ? "only Finite Monkey" : "only gitleaks"}`);
  });

const available = spawnSync("gitleaks", ["version"], { encoding: "utf8" }).status === 0;
const required = process.env["FM_REQUIRE_GITLEAKS"] === "1";

describe("embedded secret rules and gitleaks agree on the shared corpus", () => {
  it("gitleaks is installed where the parity check is required", () => {
    assert.ok(available || !required, "FM_REQUIRE_GITLEAKS=1 but gitleaks is not on PATH");
  });

  it("every mirrored rule fires on the same corpus cases in both engines", { skip: !available }, () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-gitleaks-"));
    try {
      CASES.forEach((item, index) => {
        writeFileSync(join(dir, fileOf(index)), `${item.text}\n`);
      });
      const report = join(dir, "..", `${String(process.pid)}-gitleaks.json`);
      const found = gitleaksFindings(dir, report);
      rmSync(report, { force: true });
      const all = divergences(found);
      const unexpected = all.filter((line) => !KNOWN_DIFFERENCES.has(line));
      assert.deepEqual(unexpected, [], `rule divergence:\n${unexpected.join("\n")}`);
      const stale = [...KNOWN_DIFFERENCES.keys()].filter((line) => !all.includes(line));
      assert.deepEqual(stale, [], `known differences that no longer happen:\n${stale.join("\n")}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
