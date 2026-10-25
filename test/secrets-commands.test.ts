import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import type { GitResult, Runtime } from "../src/core/runtime.js";
import { BASELINE_FILE, parseBaseline } from "../src/secrets/baseline.js";
import { listIncidents, recordIncident } from "../src/secrets/incidents.js";
import { SAMPLES } from "./secret-samples.js";
import { cli, cliJson, fakeRuntime, type FakeRuntimeOptions, field, gitMissing } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const BASELINE = toAbsolutePath(`${ROOT}/${BASELINE_FILE}`);

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const project = (files: Readonly<Record<string, string>>, extra: FakeRuntimeOptions = {}): Runtime =>
  fakeRuntime({
    ...extra,
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [`${ROOT}/${name}`, text])),
  });

const ids = (body: unknown): readonly string[] => {
  const findings = field(body, "data", "findings");
  return Array.isArray(findings) ? findings.map((item) => String(field(item, "id"))) : [];
};

const statuses = (body: unknown): readonly string[] => {
  const findings = field(body, "data", "findings");
  return Array.isArray(findings) ? findings.map((item) => String(field(item, "status"))) : [];
};

const firstFinding = (body: unknown): unknown => {
  const findings = field(body, "data", "findings");
  return Array.isArray(findings) ? findings[0] : undefined;
};

const leaked = (text: string): boolean => Object.values(SAMPLES).some((secret) => text.includes(secret));

describe("secrets scan --path with the baseline ratchet", () => {
  const files = { "src/a.ts": `export const t = "${SAMPLES.githubPat}";\n`, "src/b.ts": "export const ok = 1;\n" };

  it("a new finding fails with exit 1, file, line, id and mask, never the value", async () => {
    const run = await cliJson(["secrets", "scan"], { runtime: project(files), cwd: ROOT });
    assert.equal(run.code, 1);
    assert.equal(field(run.body, "error", "code"), "secrets_found");
    assert.equal(field(run.body, "data", "schema"), "finitemonkey/secrets-scan@1");
    assert.deepEqual(statuses(run.body), ["new"]);
    const first = firstFinding(run.body);
    assert.equal(field(first, "file"), "src/a.ts");
    assert.equal(field(first, "line"), 1);
    assert.match(String(field(first, "mask")), /^«secret:github-pat:/);
    assert.ok(!leaked(run.stdout));
  });

  it("only the person can accept, and an accepted finding stops failing", async () => {
    const runtime = project(files, {
      git: (args) => (args[0] === "config" ? { found: true, ok: true, stdout: "Ana\n" } : gitMissing),
    });
    const [id] = ids((await cliJson(["secrets", "scan"], { runtime, cwd: ROOT })).body);
    assert.ok(id !== undefined);
    const byModel = await cliJson(["secrets", "accept", id, "--reason", "fixture"], { runtime, cwd: ROOT });
    assert.equal(byModel.code, 4);
    const insideClaude = await cliJson(["secrets", "accept", id, "--reason", "x"], {
      runtime,
      cwd: ROOT,
      stdin: tty(),
      env: { CLAUDECODE: "1" },
    });
    assert.equal(insideClaude.code, 4);
    const noReason = await cliJson(["secrets", "accept", id], { runtime, cwd: ROOT, stdin: tty() });
    assert.equal(noReason.code, 2);
    const accepted = await cliJson(["secrets", "accept", id, "--reason", "rotated test key", "--days", "30"], {
      runtime,
      cwd: ROOT,
      stdin: tty(),
    });
    assert.equal(accepted.code, 0, accepted.stdout);
    assert.equal(field(accepted.body, "data", "owner"), "Ana");
    assert.equal(field(accepted.body, "data", "expiresAt"), "2026-11-24T12:00:00.000Z");
    const baseline = runtime.readText(BASELINE);
    assert.ok(baseline.ok && !leaked(baseline.value));
    const again = await cliJson(["secrets", "scan"], { runtime, cwd: ROOT });
    assert.equal(again.code, 0);
    assert.deepEqual(statuses(again.body), ["known"]);
  });

  it("a fixed finding leaves the baseline; a new one still fails", async () => {
    const runtime = project(files);
    const [id] = ids((await cliJson(["secrets", "scan"], { runtime, cwd: ROOT })).body);
    await cli(["secrets", "accept", id ?? "", "--reason", "known"], { runtime, cwd: ROOT, stdin: tty() });
    runtime.writeText(toAbsolutePath(`${ROOT}/src/a.ts`), "export const t = process.env.TOKEN;\n");
    runtime.writeText(toAbsolutePath(`${ROOT}/src/c.ts`), `const k = "${SAMPLES.gcp}";\n`);
    const run = await cliJson(["secrets", "scan"], { runtime, cwd: ROOT });
    assert.equal(run.code, 1);
    assert.deepEqual(field(run.body, "data", "fixed"), [id]);
    assert.deepEqual(statuses(run.body), ["new"]);
    const saved = runtime.readText(BASELINE);
    const parsed = saved.ok ? parseBaseline(saved.value) : undefined;
    assert.deepEqual(parsed?.ok === true ? parsed.value.entries : undefined, []);
  });

  it("an expired acceptance blocks again", async () => {
    const runtime = project(files);
    const [id] = ids((await cliJson(["secrets", "scan"], { runtime, cwd: ROOT })).body);
    await cli(["secrets", "accept", id ?? "", "--reason", "x", "--days", "1"], { runtime, cwd: ROOT, stdin: tty() });
    const saved = runtime.readText(BASELINE);
    const later = project(
      { ...files, [BASELINE_FILE]: saved.ok ? saved.value : "" },
      { now: "2026-12-31T00:00:00.000Z" },
    );
    const run = await cliJson(["secrets", "scan"], { runtime: later, cwd: ROOT });
    assert.equal(run.code, 1);
    assert.deepEqual(statuses(run.body), ["expired"]);
  });

  it("a broken baseline is reported, not ignored", async () => {
    const run = await cliJson(["secrets", "scan"], {
      runtime: project({ ...files, [BASELINE_FILE]: "{nope" }),
      cwd: ROOT,
    });
    assert.equal(run.code, 3);
    assert.equal(field(run.body, "error", "code"), "secrets_baseline_invalid");
  });

  it("placeholders in .env.example and fixtures pass the scan", async () => {
    const clean = {
      ".env.example": 'ASAAS_ENV="sandbox"\nASAAS_API_KEY=""\nASAAS_KEY_SAMPLE=$aact_YOUR_KEY_HERE\n',
      "docs/plan.md": "ASAAS_API_KEY=$aact_hmlg_...      # chave da conta raiz\n",
      "src/lib/asaas/asaas.test.ts": "assertKeyMatchesEnvironment('$aact_prod_xyz', 'sandbox')\n",
    };
    const run = await cliJson(["secrets", "scan"], { runtime: project(clean), cwd: ROOT });
    assert.equal(run.code, 0);
    assert.equal(field(run.body, "data", "summary", "total"), 0);
  });

  it("--staged and --history cannot be combined", async () => {
    const run = await cliJson(["secrets", "scan", "--staged", "--history"], { runtime: project(files), cwd: ROOT });
    assert.equal(run.code, 2);
  });
});

const stagedDiff = (secret: string): string =>
  [
    "diff --git a/.env b/.env",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/.env",
    "@@ -0,0 +1,2 @@",
    "+NODE_ENV=dev",
    `+GITHUB_TOKEN=${secret}`,
    "",
  ].join("\n");

describe("secrets scan --staged", () => {
  const git =
    (diff: string) =>
    (args: readonly string[]): GitResult => ({
      found: true,
      ok: args.includes("--cached"),
      stdout: args.includes("--cached") ? diff : "",
    });

  it("fails the pre-commit with the staged file and line", async () => {
    const run = await cliJson(["secrets", "scan", "--staged"], {
      runtime: project({}, { git: git(stagedDiff(SAMPLES.githubPat)) }),
      cwd: ROOT,
    });
    assert.equal(run.code, 1);
    const first = firstFinding(run.body);
    assert.equal(field(first, "file"), ".env");
    assert.equal(field(first, "line"), 2);
    assert.ok(!leaked(run.stdout));
  });

  it("passes when nothing staged has a secret", async () => {
    const run = await cliJson(["secrets", "scan", "--staged"], {
      runtime: project({}, { git: git(stagedDiff("${GITHUB_TOKEN}")) }),
      cwd: ROOT,
    });
    assert.equal(run.code, 0);
  });

  it("says git is unavailable instead of passing", async () => {
    const run = await cliJson(["secrets", "scan", "--staged"], { runtime: project({}), cwd: ROOT });
    assert.equal(run.code, 3);
    assert.equal(field(run.body, "error", "code"), "secrets_git_unavailable");
  });
});

describe("secrets scan --history and incidents", () => {
  const log = [
    "commit 2222222222222222222222222222222222222222",
    "diff --git a/src/c.ts b/src/c.ts",
    "--- a/src/c.ts",
    "+++ b/src/c.ts",
    "@@ -1 +0,0 @@",
    `-const k = "${SAMPLES.slackBot}";`,
    "commit 1111111111111111111111111111111111111111",
    "diff --git a/src/c.ts b/src/c.ts",
    "--- /dev/null",
    "+++ b/src/c.ts",
    "@@ -0,0 +1 @@",
    `+const k = "${SAMPLES.slackBot}";`,
    "diff --git a/src/d.ts b/src/d.ts",
    "--- /dev/null",
    "+++ b/src/d.ts",
    "@@ -0,0 +1 @@",
    '+const s = process.env.JWT_SECRET ?? "fallback-value";',
  ];

  it("a credential in an old commit opens an incident with the first commit; a bad practice does not", async () => {
    const runtime = project({}, { gitLines: () => log });
    const run = await cliJson(["secrets", "scan", "--history"], { runtime, cwd: ROOT });
    assert.equal(run.code, 1);
    const incident = listIncidents(runtime, ROOT).at(0);
    assert.ok(incident !== undefined);
    assert.equal(incident.state, "aberto");
    assert.equal(incident.source, "history");
    assert.equal(incident.firstCommit, "1111111111111111111111111111111111111111");
    assert.equal(incident.where, "src/c.ts:1");
    assert.deepEqual(field(run.body, "data", "incidents"), [incident.id]);
    assert.equal(listIncidents(runtime, ROOT).length, 1);
    assert.equal(field(run.body, "data", "summary", "new"), 2);
  });

  it("rotation comes before the history purge, and both are the person's", async () => {
    const runtime = project({});
    const recorded = recordIncident(
      runtime,
      ROOT,
      { rule: "github-pat", fingerprint: "0123456789abcdef", where: "src/a.ts:3", source: "scan", state: "aberto" },
      "finitemonkey",
    );
    assert.ok(recorded.ok);
    const id = recorded.value.id;
    const listed = await cliJson(["secrets", "incident"], { runtime, cwd: ROOT });
    const incidents = field(listed.body, "data", "incidents");
    assert.deepEqual(Array.isArray(incidents) ? incidents.map((item) => field(item, "state")) : [], ["aberto"]);
    const purgeEarly = await cliJson(["secrets", "incident", "purge", id], { runtime, cwd: ROOT, stdin: tty() });
    assert.equal(purgeEarly.code, 4);
    assert.equal(field(purgeEarly.body, "error", "code"), "secrets_not_rotated");
    const closeEarly = await cliJson(["secrets", "incident", "close", id], { runtime, cwd: ROOT, stdin: tty() });
    assert.equal(field(closeEarly.body, "error", "code"), "secrets_not_rotated");
    const byModel = await cliJson(["secrets", "incident", "rotated", id], { runtime, cwd: ROOT });
    assert.equal(byModel.code, 4);
    const rotated = await cliJson(["secrets", "incident", "rotated", id], { runtime, cwd: ROOT, stdin: tty() });
    assert.equal(field(rotated.body, "data", "state"), "rotacionado");
    const purge = await cli(["secrets", "incident", "purge", id], { runtime, cwd: ROOT });
    assert.equal(purge.code, 0);
    assert.match(purge.stdout, /git filter-repo --replace-text/);
    assert.match(purge.stdout, /Finite Monkey never runs them/);
    const closed = await cliJson(["secrets", "incident", "close", id], { runtime, cwd: ROOT, stdin: tty() });
    assert.equal(field(closed.body, "data", "state"), "fechado");
    const states = listIncidents(runtime, ROOT)
      .at(0)
      ?.history.map((event) => event.state);
    assert.deepEqual(states, ["aberto", "rotacionado", "fechado"]);
  });

  it("an unknown incident id is a usage error", async () => {
    const run = await cliJson(["secrets", "incident", "rotated", "inc-000000000000"], {
      runtime: project({}),
      cwd: ROOT,
    });
    assert.equal(field(run.body, "error", "code"), "secrets_incident_not_found");
  });
});
