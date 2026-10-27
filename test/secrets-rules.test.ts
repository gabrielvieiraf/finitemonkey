import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanText } from "../src/secrets/engine.js";
import { shannonEntropy } from "../src/secrets/entropy.js";
import { RULES } from "../src/secrets/rules/catalog.js";
import { NEGATIVES as negatives, POSITIVES as positives } from "./secret-corpus.js";
import { SAMPLES } from "./secret-samples.js";

const rulesOf = (text: string, path?: string): readonly string[] =>
  scanText(text, path === undefined ? {} : { path }).map((finding) => finding.ruleId);

describe("secret rules: each rule finds its true positive", () => {
  for (const { rule, text } of positives) {
    it(`${rule} fires`, () => {
      assert.deepEqual(rulesOf(text), [rule]);
    });
  }

  it("every rule in the catalog has a true-positive case", () => {
    const covered = new Set<string>(positives.map(({ rule }) => rule));
    for (const rule of RULES) assert.ok(covered.has(rule.id), `${rule.id} has no positive case`);
  });

  it("rule ids are unique and kebab-case", () => {
    const ids = RULES.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("secret rules: placeholders and fixtures are not secrets", () => {
  for (const { name, text } of negatives) {
    it(`${name} passes`, () => {
      assert.deepEqual(rulesOf(text), []);
    });
  }

  it("generic rules skip lockfiles and test paths, provider rules do not", () => {
    const generic = `const apiKey = "${SAMPLES.genericValue}";`;
    assert.deepEqual(rulesOf(generic, "package-lock.json"), []);
    assert.deepEqual(rulesOf(generic, "test/fixtures/config.ts"), []);
    assert.deepEqual(rulesOf(generic, "src/lib/asaas/asaas.test.ts"), []);
    assert.deepEqual(rulesOf(generic, "src/modules/identity/examples/usage.ts"), []);
    assert.deepEqual(rulesOf(generic, "src/config.ts"), ["generic-api-key"]);
    assert.deepEqual(rulesOf(SAMPLES.githubPat, "test/fixtures/config.ts"), ["github-pat"]);
  });

  it("disabled TLS is allowed in tests but not in production code or docs", () => {
    const text = "requests.get(url, verify=False)";
    assert.deepEqual(rulesOf(text, "tests/test_client.py"), []);
    assert.deepEqual(rulesOf(text, "app/client.py"), ["tls-disabled"]);
    assert.deepEqual(rulesOf(text, "docs/SETUP.md"), ["tls-disabled"]);
    const args = `command: redis-server --requirepass ${SAMPLES.argValue}`;
    assert.deepEqual(rulesOf(args, "README.md"), ["secret-in-process-args"]);
  });

  it("process arguments and disabled TLS are warnings, credentials are not", () => {
    const severity = (id: string): string | undefined => RULES.find((rule) => rule.id === id)?.severity;
    assert.equal(severity("secret-in-process-args"), "warning");
    assert.equal(severity("tls-disabled"), "warning");
    assert.equal(severity("github-pat"), "high");
  });
});

describe("secret engine reporting", () => {
  it("reports 1-based line and column, a fingerprint and the last four characters", () => {
    const text = `first line\n  second ${SAMPLES.githubPat} tail\n`;
    const [finding] = scanText(text);
    assert.ok(finding !== undefined);
    assert.equal(finding.line, 2);
    assert.equal(finding.column, 10);
    assert.equal(text.slice(finding.start, finding.end), SAMPLES.githubPat);
    assert.equal(finding.tail, SAMPLES.githubPat.slice(-4));
    assert.match(finding.fingerprint, /^[0-9a-f]{16}$/);
    assert.ok(!JSON.stringify(finding).includes(SAMPLES.githubPat));
  });

  it("a provider rule wins over the generic rule for the same span", () => {
    assert.deepEqual(rulesOf(`GITHUB_TOKEN = "${SAMPLES.githubPat}"`), ["github-pat"]);
  });

  it("finds several secrets in order", () => {
    const text = `a=${SAMPLES.gcp}\nb=${SAMPLES.npmToken}\n`;
    assert.deepEqual(rulesOf(text), ["gcp-api-key", "npm-access-token"]);
  });

  it("entropy is zero for empty text and grows with variety", () => {
    assert.equal(shannonEntropy(""), 0);
    assert.equal(shannonEntropy("aaaa"), 0);
    assert.ok(shannonEntropy(SAMPLES.genericValue) > 4);
  });
});

const megabyte = (): string => {
  const line = (index: number): string =>
    `const value${String(index)} = compute(item${String(index)}, "token key secret password ${String(index)}");`;
  const lines: string[] = [];
  let size = 0;
  for (let index = 0; size < 1024 * 1024; index += 1) {
    const next = line(index);
    lines.push(next);
    size += next.length + 1;
  }
  return lines.join("\n").slice(0, 1024 * 1024);
};

describe("secret engine performance budget", () => {
  it("scans 1 MB of keyword-dense text in under 50 ms (best of 5)", () => {
    const text = `${megabyte()}\n${SAMPLES.githubPat}`;
    const times: number[] = [];
    let found = 0;
    for (let round = 0; round < 5; round += 1) {
      const started = performance.now();
      found = scanText(text).length;
      times.push(performance.now() - started);
    }
    const best = Math.min(...times);
    assert.equal(found, 1);
    assert.ok(best < 50, `best run took ${best.toFixed(1)} ms`);
  });
});
