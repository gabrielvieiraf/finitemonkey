import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import type { Runtime } from "../src/core/runtime.js";
import { BASELINE_FILE, parseBaseline, ratchetFor, stableFindingId } from "../src/findings/baseline.js";
import { writeSession } from "../src/gate/baseline.js";
import { secretsCheck } from "../src/gate/checks/secrets.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { fmPaths } from "../src/task/paths.js";
import { SAMPLES } from "./secret-samples.js";
import { cli, cliJson, fakeRuntime, type FakeRuntimeOptions, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const BASELINE = toAbsolutePath(BASELINE_FILE, ROOT);
const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const project = (files: Readonly<Record<string, string>>, extra: FakeRuntimeOptions = {}): Runtime =>
  fakeRuntime({
    ...extra,
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [toAbsolutePath(name, ROOT), text])),
  });

const FILES = { "src/a.ts": `export const t = "${SAMPLES.githubPat}";\n` };

const appsecEntry = {
  check: "appsec",
  id: stableFindingId("appsec", "route-auth", "src/routes/users.ts", "f00d"),
  rule: "route-auth",
  file: "src/routes/users.ts",
  line: 12,
  fingerprint: "f00d",
  state: "aceito",
  owner: "Ana",
  reason: "internal route behind the VPN",
  acceptedAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-12-01T00:00:00.000Z",
};

const firstId = async (runtime: Runtime): Promise<string> => {
  const findings = field((await cliJson(["secrets", "scan"], { runtime, cwd: ROOT })).body, "data", "findings");
  return Array.isArray(findings) ? String(field(findings[0], "id")) : "";
};

const savedEntries = (runtime: Runtime) => {
  const text = runtime.readText(BASELINE);
  const parsed = text.ok ? parseBaseline(text.value) : undefined;
  return parsed?.ok === true ? parsed.value.entries : [];
};

describe("one findings baseline for every check", () => {
  it("secrets keep working with the shared baseline and leave other checks' entries alone", async () => {
    const shared = JSON.stringify({ schema: "finitemonkey/findings-baseline@1", entries: [appsecEntry] });
    const runtime = project({ ...FILES, [BASELINE_FILE]: shared });
    const id = await firstId(runtime);
    const accepted = await cli(["findings", "accept", id, "--reason", "rotated test key", "--days", "30"], {
      runtime,
      cwd: ROOT,
      stdin: tty(),
    });
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.deepEqual(
      savedEntries(runtime).map((entry) => [entry.check, entry.id]),
      [
        ["appsec", appsecEntry.id],
        ["secrets", id],
      ],
    );
    const run = await cliJson(["secrets", "scan"], { runtime, cwd: ROOT });
    assert.equal(run.code, 0);
    const text = runtime.readText(BASELINE);
    assert.match(text.ok ? text.value : "", /"schema": "finitemonkey\/findings-baseline@1"/);
  });

  it("reads a baseline written before the shared schema as secrets entries", () => {
    const legacy = JSON.stringify({
      schema: "finitemonkey/secrets-baseline@1",
      entries: [{ ...appsecEntry, check: undefined, id: "fm-0123456789abcdef", rule: "github-pat" }],
    });
    const parsed = parseBaseline(legacy);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.entries[0]?.check, "secrets");
  });

  it("an expired acceptance blocks again, through secrets accept or findings accept", async () => {
    const runtime = project(FILES);
    const id = await firstId(runtime);
    await cli(["findings", "accept", id, "--reason", "x", "--days", "1"], { runtime, cwd: ROOT, stdin: tty() });
    const saved = runtime.readText(BASELINE);
    const later = project(
      { ...FILES, [BASELINE_FILE]: saved.ok ? saved.value : "" },
      { now: "2026-12-31T00:00:00.000Z" },
    );
    const run = await cliJson(["secrets", "scan"], { runtime: later, cwd: ROOT });
    assert.equal(run.code, 1);
    const findings = field(run.body, "data", "findings");
    assert.ok(Array.isArray(findings));
    assert.equal(field(findings[0], "status"), "expired");
  });

  it("splits any check's findings into new, known and expired by stable id", () => {
    const baseline = { schema: "finitemonkey/findings-baseline@1" as const, entries: [appsecEntry] } as const;
    const parsed = parseBaseline(JSON.stringify(baseline));
    assert.ok(parsed.ok);
    const known = { id: appsecEntry.id };
    const fresh = { id: stableFindingId("appsec", "route-auth", "src/routes/orders.ts", "beef") };
    const before = ratchetFor("appsec", [known, fresh], parsed.value, "2026-11-01T00:00:00.000Z", undefined);
    assert.deepEqual([before.fresh, before.known, before.expired], [[fresh], [known], []]);
    const after = ratchetFor("appsec", [known], parsed.value, "2026-12-02T00:00:00.000Z", undefined);
    assert.deepEqual(after.expired, [known]);
    assert.deepEqual(ratchetFor("secrets", [known], parsed.value, "2026-11-01T00:00:00.000Z", undefined).fresh, [
      known,
    ]);
  });

  it("only the person changes the baseline: the model gets needs-person", async () => {
    const runtime = project(FILES);
    const id = await firstId(runtime);
    const byModel = await cliJson(["findings", "accept", id, "--reason", "fixture"], {
      runtime,
      cwd: ROOT,
      env: { CLAUDECODE: "1" },
      stdin: tty(),
    });
    assert.equal(byModel.code, 4);
    assert.deepEqual(savedEntries(runtime), []);
  });

  it("lists every check's entries and marks the expired ones", async () => {
    const shared = JSON.stringify({ schema: "finitemonkey/findings-baseline@1", entries: [appsecEntry] });
    const runtime = project({ [BASELINE_FILE]: shared }, { now: "2026-12-05T00:00:00.000Z" });
    const list = await cliJson(["findings", "list"], { runtime, cwd: ROOT });
    const entries = field(list.body, "data", "entries");
    assert.ok(Array.isArray(entries));
    assert.equal(field(entries[0], "check"), "appsec");
    assert.equal(field(entries[0], "expired"), true);
  });
});

const fire = (input: Readonly<Record<string, unknown>>, runtime: Runtime): Promise<HookOutcome> =>
  runHook("PreToolUse", {
    stdin: stdinOf({ hook_event_name: "PreToolUse", session_id: "s1", cwd: ROOT, ...input }),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: ROOT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  });

const stdinOf = (value: unknown): TextSource => Readable.from([JSON.stringify(value)]);

describe("the model cannot edit the baseline file", () => {
  const cases = [
    { tool_name: "Write", tool_input: { file_path: BASELINE, content: '{"schema":"x","entries":[]}' } },
    { tool_name: "Edit", tool_input: { file_path: BASELINE, old_string: "2026-11", new_string: "2099-11" } },
    { tool_name: "Bash", tool_input: { command: `echo '{}' > ${BASELINE_FILE}` } },
    { tool_name: "Bash", tool_input: { command: `sed -i s/2026/2099/ ${BASELINE_FILE}` } },
  ];
  for (const input of cases) {
    it(`${input.tool_name} is blocked by the self guard`, async () => {
      const outcome = await fire(input, project(FILES));
      assert.equal(outcome.verdict, "block");
    });
  }
});

describe("a growing baseline raises an alarm at Stop", () => {
  it("warns when the baseline has more entries than at session start", () => {
    const shared = JSON.stringify({ schema: "finitemonkey/findings-baseline@1", entries: [appsecEntry] });
    const runtime = project({ [BASELINE_FILE]: shared }, { git: () => ({ found: true, ok: true, stdout: "" }) });
    const paths = fmPaths(ROOT);
    writeSession(runtime, paths, { sessionId: "s1", startTree: "t", at: 0, findings: 0 });
    const outcome = secretsCheck({ id: "secrets", kind: "secrets" }, { runtime, paths });
    assert.ok(outcome.notes.some((item) => item.key === "gate.findings.grew"));
    writeSession(runtime, paths, { sessionId: "s1", startTree: "t", at: 0, findings: 1 });
    const same = secretsCheck({ id: "secrets", kind: "secrets" }, { runtime, paths });
    assert.ok(!same.notes.some((item) => item.key === "gate.findings.grew"));
  });
});
