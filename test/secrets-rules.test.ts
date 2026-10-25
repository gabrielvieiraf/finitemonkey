import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanText } from "../src/secrets/engine.js";
import { shannonEntropy } from "../src/secrets/entropy.js";
import { RULES } from "../src/secrets/rules/catalog.js";
import { randomText, SAMPLES } from "./secret-samples.js";

const rulesOf = (text: string, path?: string): readonly string[] =>
  scanText(text, path === undefined ? {} : { path }).map((finding) => finding.ruleId);

const positives = [
  { rule: "aws-access-token", text: `aws_access_key_id = ${SAMPLES.awsAccessKey}` },
  { rule: "aws-secret-access-key", text: `aws_secret_access_key = ${SAMPLES.awsSecretKey}` },
  { rule: "github-pat", text: `GITHUB_TOKEN=${SAMPLES.githubPat}` },
  { rule: "github-oauth", text: `token: ${SAMPLES.githubOauth}` },
  { rule: "github-app-token", text: `"${SAMPLES.githubApp}"` },
  { rule: "github-refresh-token", text: SAMPLES.githubRefresh },
  { rule: "github-fine-grained-pat", text: `export GH=${SAMPLES.githubFineGrained}` },
  { rule: "gitlab-pat", text: `GITLAB=${SAMPLES.gitlabPat}` },
  { rule: "npm-access-token", text: `//registry.npmjs.org/:_authToken=${SAMPLES.npmToken}` },
  { rule: "slack-bot-token", text: `SLACK_BOT=${SAMPLES.slackBot}` },
  { rule: "slack-user-token", text: SAMPLES.slackUser },
  { rule: "slack-app-token", text: SAMPLES.slackApp },
  { rule: "slack-webhook-url", text: `url: ${SAMPLES.slackWebhook}` },
  { rule: "stripe-access-token", text: `STRIPE_SECRET_KEY=${SAMPLES.stripeLive}` },
  { rule: "anthropic-api-key", text: `ANTHROPIC_API_KEY=${SAMPLES.anthropic}` },
  { rule: "openai-api-key", text: `OPENAI_API_KEY=${SAMPLES.openai}` },
  { rule: "gcp-api-key", text: `const maps = "${SAMPLES.gcp}";` },
  { rule: "asaas-api-key", text: `ASAAS_API_KEY=${SAMPLES.asaas}` },
  { rule: "private-key", text: `key: |\n${SAMPLES.privateKey}\n` },
  { rule: "jwt", text: `Authorization: Bearer ${SAMPLES.jwt}` },
  { rule: "credential-in-url", text: `DATABASE_URL=postgres://app:${SAMPLES.urlPassword}@db.internal:5432/app` },
  {
    rule: "credential-in-url",
    text: `origin https://gabriel:${SAMPLES.githubPat.slice(4)}@github.com/x/y.git (fetch)`,
  },
  { rule: "default-secret-fallback", text: `const key = process.env.ENCRYPTION_KEY ?? "0000000000000000";` },
  {
    rule: "default-secret-fallback",
    text: "const key = process.env.ENCRYPTION_KEY || 'default-key-change-in-production'",
  },
  { rule: "default-secret-fallback-python", text: `secret = os.getenv("JWT_SECRET", "dev-secret")` },
  { rule: "generic-api-key", text: `const apiKey = "${SAMPLES.genericValue}";` },
  { rule: "generic-api-key", text: `MAILGUN_KEY: ${SAMPLES.genericValue}` },
  { rule: "password-assignment", text: `DB_PASSWORD=${SAMPLES.password}` },
  { rule: "password-assignment", text: `{"senha": "${SAMPLES.password}"}` },
] as const;

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

const negatives = [
  { name: "Asaas placeholder in .env.example", text: "ASAAS_API_KEY=$aact_YOUR_KEY_HERE" },
  { name: "Asaas empty value in .env.example", text: 'ASAAS_API_KEY=""            # Chave da conta' },
  { name: "Asaas sandbox prefix in docs", text: "ASAAS_API_KEY=$aact_hmlg_...      # chave da conta raiz" },
  { name: "Asaas production prefix in docs", text: "chave `$aact_prod_` no `.env.prod`" },
  { name: "Asaas test fixture", text: "assertKeyMatchesEnvironment('$aact_prod_xyz', 'sandbox')" },
  { name: "AWS documented example key", text: "AKIAIOSFODNN7EXAMPLE" },
  { name: "AWS documented example secret", text: "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  { name: "GitHub token placeholder", text: "GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  { name: "Stripe placeholder", text: "STRIPE_SECRET_KEY=sk_live_your_key_here_change_me" },
  { name: "Stripe test key", text: `STRIPE_KEY=${["sk", "test", randomText(24)].join("_")}` },
  { name: "env reference", text: "API_TOKEN=${API_TOKEN}" },
  { name: "process.env read", text: "const token = process.env.GITHUB_TOKEN;" },
  { name: "zod schema", text: "password: z.string().min(8)," },
  { name: "TypeScript type", text: "interface Login { password: string; token: string }" },
  { name: "i18n key", text: 'messageKey: "error.i18n_catalog_unreadable",' },
  { name: "schema name", text: 'export const SECRETS_SCAN_SCHEMA = "finitemonkey/secrets-scan@1";' },
  { name: "URL with placeholder password", text: "postgres://user:password@localhost:5432/db" },
  { name: "URL with template password", text: "postgres://app:${DB_PASSWORD}@db:5432/app" },
  { name: "PEM header in docs", text: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" },
  { name: "low-entropy JWT-looking text", text: "eyJaaaaaaaaaaaaaaaaaaaaa.eyJaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaa" },
  { name: "object key with digits", text: "{ key: 'installment7to12', label: 'Parcelas 7 a 12x' }," },
  {
    name: "key computed by a call",
    text: "applicationServerKey: urlBase64ToUint8Array(vapidPublicKey2024) as BufferSource,",
  },
  {
    name: "wallet pass id fallback",
    text: "passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID || 'pass.com.example.event',",
  },
  { name: "prose", text: "Rotate the key, then update the secret in the vault and the token in CI." },
] as const;

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
