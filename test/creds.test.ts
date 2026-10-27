import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { GitResult, Runtime } from "../src/core/runtime.js";
import { checkEnvHygiene } from "../src/doctor/env-hygiene.js";
import { secretsCheck } from "../src/gate/checks/secrets.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { BUNDLE, BUNDLE_TEXT, cliJson, fakeRuntime, field, reasonText, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (path: string): string => toAbsolutePath(path, ROOT);
const FAKE_VALUE = "fake-value-not-a-secret-7f3a";

interface RepoOptions {
  readonly ignored?: readonly string[];
  readonly history?: string;
}

const repo = (files: Readonly<Record<string, string>>, options: RepoOptions = {}) => {
  const fs = memoryFs(
    { [BUNDLE]: BUNDLE_TEXT, ...Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])) },
    [],
  );
  const listed = Object.keys(files).filter((file) => !(options.ignored ?? []).includes(file));
  const git = (args: readonly string[]): GitResult => {
    if (args[0] === "rev-parse") return { found: true, ok: true, stdout: `${ROOT}\n` };
    if (args[0] === "ls-files" && args.includes("-z")) return { found: true, ok: true, stdout: "" };
    if (args[0] === "ls-files") return { found: true, ok: true, stdout: `${listed.join("\n")}\n` };
    if (args[0] === "diff") return { found: true, ok: true, stdout: "" };
    if (args[0] === "check-ignore")
      return { found: true, ok: (options.ignored ?? []).includes(args.at(-1) ?? ""), stdout: "" };
    if (args[0] === "log") return { found: true, ok: true, stdout: options.history ?? "" };
    return { found: true, ok: false, stdout: "" };
  };
  return { runtime: fakeRuntime({ fs, git }), fs };
};

const doctor = (runtime: Runtime) =>
  checkEnvHygiene({ platform: "linux", env: {}, cwd: ROOT, root: ROOT, version: "1.0.0", runtime });

const writeWorkflow = (runtime: Runtime, content: string, tool = "Write"): Promise<HookOutcome> =>
  runHook("PreToolUse", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        cwd: ROOT,
        tool_name: tool,
        tool_input:
          tool === "Write"
            ? { file_path: at(".github/workflows/deploy.yml"), content }
            : { file_path: at(".github/workflows/deploy.yml"), old_string: "x", new_string: content },
      }),
    ),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: ROOT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  });

const AWS_STEP = [
  "      - run: aws s3 sync dist s3://site",
  "        env:",
  "          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}",
  "          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}",
].join("\n");

describe("creds-static guard", () => {
  it("blocks a workflow that reads secrets.AWS_ACCESS_KEY_ID and offers the OIDC role", async () => {
    const outcome = await writeWorkflow(repo({}).runtime, `jobs:\n  deploy:\n    steps:\n${AWS_STEP}\n`);
    assert.equal(outcome.verdict, "block");
    const reason = reasonText(outcome);
    assert.match(reason, /static cloud key AWS_ACCESS_KEY_ID/);
    assert.match(reason, /id-token: write/);
    assert.match(reason, /aws-actions\/configure-aws-credentials/);
    assert.match(reason, /role-to-assume/);
  });

  it("offers workload identity for a Google Cloud key", async () => {
    const outcome = await writeWorkflow(
      repo({}).runtime,
      "      with:\n        credentials_json: ${{ secrets.GCP_SA_KEY }}\n",
      "Edit",
    );
    assert.equal(outcome.verdict, "block");
    assert.match(reasonText(outcome), /workload_identity_provider/);
  });

  it("lets an edit through when the file already read the key, and allows other secrets", async () => {
    const existing = { ".github/workflows/deploy.yml": `steps:\n${AWS_STEP}\n` };
    assert.equal((await writeWorkflow(repo(existing).runtime, AWS_STEP, "Edit")).verdict, "allow");
    const npm = "        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n";
    assert.equal((await writeWorkflow(repo({}).runtime, npm)).verdict, "allow");
  });

  it("records the exception when the person allowed creds-static", async () => {
    const { runtime, fs } = repo({});
    const grants = {
      grants: [
        {
          guard: "creds-static",
          reason: "legacy account without OIDC",
          grantedAt: "2026-10-25T11:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ],
    };
    runtime.writeText(fmPaths(ROOT).grants, JSON.stringify(grants));
    const outcome = await writeWorkflow(runtime, AWS_STEP);
    assert.equal(outcome.verdict, "allow");
    const log = fs.read(fmPaths(ROOT).log) ?? "";
    assert.match(
      log,
      /"event":"creds_exception".*"variable":"AWS_ACCESS_KEY_ID".*"reason":"legacy account without OIDC"/,
    );
  });
});

const PROJECT = {
  "apps/api/src/s3.ts":
    "const key = process.env.AWS_SECRET_ACCESS_KEY;\nconst stripe = process.env['STRIPE_SECRET_KEY'];\n",
  "apps/worker/main.py": 'import os\nsecret = os.environ["AWS_SECRET_ACCESS_KEY"]\nport = os.getenv("PORT")\n',
  ".github/workflows/release.yml": "env:\n  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n",
  ".env.production": `AWS_SECRET_ACCESS_KEY=${FAKE_VALUE}\nSTRIPE_SECRET_KEY=${FAKE_VALUE}\n`,
  ".env.example": "AWS_SECRET_ACCESS_KEY=\nSTRIPE_SECRET_KEY=\nPORT=\n",
};

describe("credential inventory", () => {
  it("writes names, places, environments, type and risk, and flags a key shared across services", async () => {
    const { runtime, fs } = repo(PROJECT, { ignored: [".env.production"] });
    const result = await cliJson(["creds"], { cwd: ROOT, runtime });
    assert.equal(result.code, 0);
    const yaml = fs.read(at(".finitemonkey/creds.yml")) ?? "";
    assert.match(
      yaml,
      /- name: AWS_SECRET_ACCESS_KEY\n {4}type: static\n {4}risk: high\n {4}cloud: aws\n {4}shared: true/,
    );
    assert.match(yaml, /services: \[apps\/api, apps\/worker\]/);
    assert.match(yaml, /environments: \[production\]/);
    assert.match(yaml, /"apps\/api\/src\/s3\.ts:1"|apps\/api\/src\/s3\.ts:1/);
    assert.match(
      yaml,
      /- name: NPM_TOKEN\n {4}type: static\n {4}risk: medium\n {4}shared: false\n {4}services: \[ci\]\n {4}environments: \[ci\]/,
    );
    assert.doesNotMatch(yaml, /PORT/);
    assert.match(result.stdout, /"name":"STRIPE_SECRET_KEY"/);
  });

  it("never writes a value into the inventory or the output", async () => {
    const { runtime, fs } = repo(PROJECT, { ignored: [".env.production"] });
    const result = await cliJson(["creds"], { cwd: ROOT, runtime });
    assert.ok(!(fs.read(at(".finitemonkey/creds.yml")) ?? "").includes(FAKE_VALUE));
    assert.ok(!result.stdout.includes(FAKE_VALUE));
    assert.ok(!result.stderr.includes(FAKE_VALUE));
  });

  it("opens an incident for a .env file in the history", async () => {
    const history = "commit:1111111111111111111111111111111111111111\n\nconfig/.env\n.env.example\n";
    const { runtime, fs } = repo({ "src/a.ts": "" }, { history });
    const result = await cliJson(["creds"], { cwd: ROOT, runtime });
    const listed = field(result.body, "data", "history");
    assert.ok(Array.isArray(listed));
    const incident = field(listed[0], "incident");
    assert.equal(typeof incident, "string");
    assert.ok(
      Object.keys(fs.files()).some((path) => path.endsWith(`/.finitemonkey/incidents/${String(incident)}.json`)),
    );
    assert.deepEqual(
      doctor(runtime).map((item) => [item.check, item.status, item.params?.["file"]]),
      [["env.history", "fail", "config/.env"]],
    );
  });
});

describe(".env hygiene", () => {
  it("fails NEXT_PUBLIC_ or VITE_ variables with a secret-like name and leaves public keys alone", () => {
    const files = {
      "web/pay.ts":
        "const k = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;\nconst a = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;\n",
      ".env": "VITE_DB_PASSWORD=x\nVITE_API_URL=https://example.test\n",
    };
    const found = doctor(repo(files, { ignored: [".env"] }).runtime);
    assert.deepEqual(
      found.filter((item) => item.check === "env.public").map((item) => [item.status, item.params?.["name"]]),
      [
        ["fail", "NEXT_PUBLIC_STRIPE_SECRET_KEY"],
        ["fail", "VITE_DB_PASSWORD"],
      ],
    );
  });

  it("fails a .env file that git does not ignore, but not .env.example", () => {
    const found = doctor(repo({ ".env": "A=1\n", ".env.example": "A=\n" }).runtime);
    assert.deepEqual(
      found.filter((item) => item.check === "env.ignored").map((item) => item.params?.["file"]),
      [".env"],
    );
  });

  it("warns about names missing from .env.example and names nobody reads", () => {
    const files = {
      "src/db.ts": "const url = process.env.DATABASE_URL;\nconst env = process.env.NODE_ENV;\n",
      ".env.example": "OLD_FLAG=\n",
    };
    assert.deepEqual(
      doctor(repo(files).runtime).map((item) => [item.check, item.status, item.messageKey]),
      [
        ["env.parity", "warn", "env.undocumented"],
        ["env.parity", "warn", "env.unused"],
      ],
    );
  });

  it("fails the gate's secrets check when a .env file is not ignored", () => {
    const { runtime } = repo({ ".env": "A=1\n" });
    const outcome = secretsCheck({ id: "secrets", kind: "secrets" }, { runtime, paths: fmPaths(ROOT) });
    assert.equal(outcome.status, "failed");
    assert.ok(outcome.notes.some((item) => item.key === "env.unignored"));
  });
});
