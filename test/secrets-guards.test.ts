import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { GitResult, Runtime } from "../src/core/runtime.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { listIncidents } from "../src/secrets/incidents.js";
import { SAMPLES } from "./secret-samples.js";
import { fakeRuntime, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");

type Event = "PreToolUse" | "UserPromptSubmit" | "PostToolUse";

const fire = (
  event: Event,
  body: Readonly<Record<string, unknown>>,
  runtime: Runtime = fakeRuntime(),
): Promise<HookOutcome> =>
  runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: ROOT, ...body })),
    deadlineMs: 2000,
    handlers: DEFAULT_HANDLERS,
    cwd: ROOT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
  });

const tool = (name: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  tool_name: name,
  tool_input: input,
});

const assertNoLeak = (outcome: HookOutcome): void => {
  for (const secret of Object.values(SAMPLES)) {
    assert.ok(!`${outcome.stdout}${outcome.stderr}`.includes(secret), "hook output leaked a secret");
  }
};

const file = `${ROOT}/src/config.ts`;

const writeCases = [
  {
    name: "Write with a token",
    input: tool("Write", { file_path: file, content: `a\nexport const t = "${SAMPLES.githubPat}";\n` }),
    block: /src\/config\.ts:2:19.*github-pat|github-pat at src\/config\.ts:2:19/,
  },
  {
    name: "Edit with a key",
    input: tool("Edit", { file_path: file, old_string: "x", new_string: `k = "${SAMPLES.awsAccessKey}"` }),
    block: /aws-access-token at src\/config\.ts \(line 1 of the new text\)/,
  },
  {
    name: "MultiEdit with a key in the second edit",
    input: tool("MultiEdit", {
      file_path: file,
      edits: [
        { old_string: "a", new_string: "b" },
        { old_string: "c", new_string: SAMPLES.stripeLive },
      ],
    }),
    block: /stripe-access-token/,
  },
  {
    name: "NotebookEdit with a private key",
    input: tool("NotebookEdit", { notebook_path: `${ROOT}/n.ipynb`, new_source: SAMPLES.privateKey }),
    block: /private-key/,
  },
  {
    name: "Write of .env.example with the Asaas placeholder",
    input: tool("Write", {
      file_path: `${ROOT}/.env.example`,
      content: 'ASAAS_API_KEY=$aact_YOUR_KEY_HERE\nASAAS_WEBHOOK_TOKEN=""\n',
    }),
    block: undefined,
  },
  {
    name: "Edit that reads the key from the environment",
    input: tool("Edit", { file_path: file, old_string: "x", new_string: "const key = process.env.ASAAS_API_KEY;" }),
    block: undefined,
  },
] as const;

describe("PreToolUse secrets guard: writes", () => {
  for (const { name, input, block } of writeCases) {
    it(`${name} ${block === undefined ? "passes" : "is blocked"}`, async () => {
      const outcome = await fire("PreToolUse", input);
      assertNoLeak(outcome);
      if (block === undefined) {
        assert.equal(outcome.verdict, "allow");
        return;
      }
      assert.equal(outcome.verdict, "block");
      assert.equal(outcome.exitCode, 2);
      assert.match(outcome.stderr, block);
      assert.match(outcome.stderr, /Nothing was written/);
    });
  }
});

const bashCases = [
  {
    name: "heredoc with a token",
    command: `cat > .env.local <<'EOF'\nGITHUB_TOKEN=${SAMPLES.githubPat}\nEOF`,
    block: /github-pat at line 2, column 14/,
  },
  { name: "echo into a file", command: `echo "OPENAI_API_KEY=${SAMPLES.openai}" >> .env`, block: /openai-api-key/ },
  {
    name: "curl with a bearer JWT",
    command: `curl -H "Authorization: Bearer ${SAMPLES.jwt}" https://api.example.com`,
    block: /jwt/,
  },
  { name: "cat .env", command: "cat .env", block: /\.env holds secrets/ },
  {
    name: "grep in .env.production",
    command: "grep DATABASE_URL apps/web/.env.production",
    block: /\.env\.production holds secrets/,
  },
  { name: "input redirect from .env", command: "while read line; do echo $line; done < .env", block: /holds secrets/ },
  { name: "head of a private key file", command: "head -n 3 ~/.ssh/id_ed25519", block: /id_ed25519 holds secrets/ },
  { name: "printenv with no filter", command: "printenv", block: /prints every environment variable/ },
  { name: "env piped to grep", command: "env | grep -i aws", block: /prints every environment variable/ },
  {
    name: "printenv of a secret name",
    command: "printenv STRIPE_SECRET_KEY",
    block: /prints every environment variable/,
  },
  {
    name: "model accepting a finding",
    command: "npx finitemonkey secrets accept fm-0123456789abcdef --reason ok",
    block: /decision for the person/,
  },
  {
    name: "model marking an incident rotated",
    command: "fm secrets incident rotated inc-0123456789ab",
    block: /decision for the person/,
  },
  { name: "cat .env.example", command: "cat .env.example", block: undefined },
  { name: "env running a command", command: "env NODE_ENV=test npm test", block: undefined },
  { name: "printenv of a harmless name", command: "printenv HOME", block: undefined },
  { name: "source .env without printing", command: "set -a && source .env && set +a && npm run dev", block: undefined },
  { name: "sed -i on .env", command: "sed -i 's/^DEBUG=.*/DEBUG=1/' .env", block: undefined },
  { name: "listing incidents", command: "finitemonkey secrets incident --json", block: undefined },
  { name: "git status", command: "git status --short", block: undefined },
] as const;

describe("PreToolUse secrets guard: Bash", () => {
  for (const { name, command, block } of bashCases) {
    it(`${name} ${block === undefined ? "passes" : "is blocked"}`, async () => {
      const outcome = await fire("PreToolUse", tool("Bash", { command }));
      assertNoLeak(outcome);
      if (block === undefined) assert.equal(outcome.verdict, "allow", outcome.stderr);
      else assert.match(outcome.stderr, block);
    });
  }

  const diff = (secret: string): string =>
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@",
      "+const ok = 1;",
      `+const t = "${secret}";`,
      "",
    ].join("\n");

  const gitWith =
    (staged: string, all: string): ((args: readonly string[]) => GitResult) =>
    (args) => ({
      found: true,
      ok: true,
      stdout: args.includes("--cached") ? staged : args.includes("HEAD") ? all : "",
    });

  it("git commit with a staged secret is blocked with file and line", async () => {
    const runtime = fakeRuntime({ git: gitWith(diff(SAMPLES.githubPat), "") });
    const outcome = await fire("PreToolUse", tool("Bash", { command: 'git commit -m "feat: x"' }), runtime);
    assert.match(outcome.stderr, /staged changes have a credential \(github-pat at src\/a\.ts:5:12\)/);
    assertNoLeak(outcome);
  });

  it("git commit -am also looks at unstaged tracked changes", async () => {
    const runtime = fakeRuntime({ git: gitWith("", diff(SAMPLES.npmToken)) });
    const outcome = await fire("PreToolUse", tool("Bash", { command: 'git -C . commit -am "fix: y"' }), runtime);
    assert.match(outcome.stderr, /npm-access-token at src\/a\.ts:5/);
  });

  it("git commit with clean staged changes passes", async () => {
    const runtime = fakeRuntime({ git: gitWith(diff("process.env.TOKEN"), "") });
    const outcome = await fire("PreToolUse", tool("Bash", { command: "git commit -m 'chore: z'" }), runtime);
    assert.equal(outcome.verdict, "allow");
  });
});

describe("PreToolUse secrets guard: reads", () => {
  const cases = [
    { name: "Read .env", input: { file_path: `${ROOT}/.env` }, block: true },
    { name: "Read .env.local", input: { file_path: `${ROOT}/.env.local` }, block: true },
    { name: "Read a pem key", input: { file_path: `${ROOT}/certs/server.pem` }, block: true },
    { name: "Read .env.example", input: { file_path: `${ROOT}/.env.example` }, block: false },
    { name: "Read source", input: { file_path: `${ROOT}/src/env.ts` }, block: false },
  ] as const;
  for (const { name, input, block } of cases) {
    it(`${name} ${block ? "is blocked" : "passes"}`, async () => {
      const outcome = await fire("PreToolUse", tool("Read", input));
      assert.equal(outcome.verdict, block ? "block" : "allow");
    });
  }
});

describe("UserPromptSubmit secrets guard", () => {
  it("blocks a prompt with a live-looking credential and records a local exposure incident", async () => {
    const runtime = fakeRuntime();
    const prompt = `please deploy\nuse this key ${SAMPLES.anthropic} thanks`;
    const outcome = await fire("UserPromptSubmit", { prompt }, runtime);
    assert.equal(outcome.verdict, "block");
    assert.match(outcome.stderr, /not sent to the model/);
    assert.match(outcome.stderr, /anthropic-api-key at line 2, column 14/);
    assert.match(outcome.stderr, /rotate it/);
    assert.match(outcome.stderr, /put it in \.env/);
    assert.match(outcome.stderr, /Never paste keys/);
    assertNoLeak(outcome);
    const incident = listIncidents(runtime, ROOT).at(0);
    assert.ok(incident !== undefined);
    assert.equal(incident.state, "exposicao-local");
    assert.equal(incident.source, "prompt");
    assert.match(outcome.stderr, new RegExp(incident.id));
  });

  const passing = [
    "my .env has ASAAS_API_KEY=$aact_YOUR_KEY_HERE, why does it fail?",
    "set const key = process.env.ENCRYPTION_KEY ?? '0000' as a fallback?",
    "the token is in GITHUB_TOKEN, please use it",
  ] as const;
  for (const prompt of passing) {
    it(`lets "${prompt.slice(0, 30)}..." through`, async () => {
      assert.equal((await fire("UserPromptSubmit", { prompt })).verdict, "allow");
    });
  }
});

describe("PostToolUse secrets guard", () => {
  it("records an incident when a tool printed a secret and tells Claude without the value", async () => {
    const runtime = fakeRuntime();
    const body = {
      ...tool("Bash", { command: "docker inspect app" }),
      tool_response: { stdout: `ok\nAWS=${SAMPLES.awsAccessKey}`, stderr: "" },
    };
    const outcome = await fire("PostToolUse", body, runtime);
    assert.equal(outcome.verdict, "allow");
    assert.match(outcome.stdout, /the Bash output contained a credential \(aws-access-token at line 2, column 5\)/);
    assertNoLeak(outcome);
    const incidents = listIncidents(runtime, ROOT);
    assert.equal(incidents.length, 1);
    assert.deepEqual(
      incidents.map((item) => [item.state, item.where]),
      [["aberto", "tool-output:Bash:2"]],
    );
    assert.equal(runtime.readText(toAbsolutePath(`${ROOT}/.finitemonkey/incidents/.gitignore`)).ok, true);
  });

  it("the same secret twice keeps one incident", async () => {
    const runtime = fakeRuntime();
    const body = { ...tool("Read", { file_path: file }), tool_response: SAMPLES.githubPat };
    await fire("PostToolUse", body, runtime);
    await fire("PostToolUse", body, runtime);
    assert.equal(listIncidents(runtime, ROOT).length, 1);
  });

  it("clean output records nothing", async () => {
    const runtime = fakeRuntime();
    const outcome = await fire("PostToolUse", { ...tool("Bash", { command: "ls" }), tool_response: "a\nb" }, runtime);
    assert.equal(outcome.stdout, `${JSON.stringify({ continue: true })}\n`);
    assert.equal(listIncidents(runtime, ROOT).length, 0);
  });
});
