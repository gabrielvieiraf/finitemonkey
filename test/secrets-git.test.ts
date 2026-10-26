import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { SAMPLES } from "./secret-samples.js";
import { BUNDLE, field, parseBody, ROOT } from "./support.js";

const IDENTITY = ["-c", "user.name=Ana", "-c", "user.email=ana@example.com", "-c", "commit.gpgsign=false"];

const git = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

const fm = (
  cwd: string,
  args: readonly string[],
  input?: string,
): { code: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [BUNDLE, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], HOME: cwd },
    timeout: 20000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const leaked = (text: string): boolean => Object.values(SAMPLES).some((secret) => text.includes(secret));

describe("secrets scan against a real git repository", () => {
  let repo = "";

  before(() => {
    repo = mkdtempSync(join(tmpdir(), "fm-secrets-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "config.ts"), `export const t = "${SAMPLES.githubPat}";\n`);
    git(repo, "add", "config.ts");
    git(repo, "commit", "-q", "-m", "feat: leak");
    writeFileSync(join(repo, "config.ts"), "export const t = process.env.GITHUB_TOKEN;\n");
    git(repo, "commit", "-q", "-am", "fix: read from env");
    writeFileSync(join(repo, ".env.example"), "ASAAS_API_KEY=$aact_YOUR_KEY_HERE\n");
    writeFileSync(join(repo, "deploy.sh"), `export NPM_TOKEN=${SAMPLES.npmToken}\n`);
    git(repo, "add", ".env.example", "deploy.sh");
  });

  after(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("--staged fails on the staged file and ignores the placeholder", () => {
    const run = fm(repo, ["secrets", "scan", "--staged", "--json"]);
    assert.equal(run.code, 1, run.stderr);
    const findings = field(parseBody(run.stdout), "data", "findings");
    assert.deepEqual(
      Array.isArray(findings)
        ? findings.map(
            (item) => `${String(field(item, "rule"))} ${String(field(item, "file"))}:${String(field(item, "line"))}`,
          )
        : [],
      ["npm-access-token deploy.sh:1"],
    );
    assert.ok(!leaked(run.stdout + run.stderr));
  });

  it("--history finds the secret removed from the tree and opens an incident outside git", () => {
    const run = fm(repo, ["secrets", "scan", "--history", "--json"]);
    assert.equal(run.code, 1, run.stderr);
    const body = parseBody(run.stdout);
    assert.equal(field(body, "data", "summary", "new"), 1);
    const incidents = readdirSync(join(repo, ".finitemonkey", "incidents")).filter((name) => name.endsWith(".json"));
    assert.equal(incidents.length, 1);
    assert.ok(existsSync(join(repo, ".finitemonkey", "incidents", ".gitignore")));
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.ok(!status.stdout.includes("incidents/"), status.stdout);
    assert.ok(!leaked(run.stdout + run.stderr));
  });

  it("the PreToolUse hook blocks git commit while the secret is staged", () => {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: 'git commit -m "feat: deploy"' },
    });
    const run = fm(repo, ["hook", "PreToolUse"], payload);
    assert.equal(run.code, 0);
    assert.match(run.stdout, /"permissionDecision":"deny"/);
    assert.match(run.stdout, /npm-access-token at deploy\.sh:1:18/);
    assert.ok(!leaked(run.stdout + run.stderr));
  });
});

describe("the Finite Monkey repository itself", () => {
  it("has no secret findings (I11)", () => {
    const run = fm(ROOT, ["secrets", "scan", "--json"]);
    assert.equal(field(parseBody(run.stdout), "data", "summary", "total"), 0, run.stdout);
    assert.equal(run.code, 0);
  });
});
