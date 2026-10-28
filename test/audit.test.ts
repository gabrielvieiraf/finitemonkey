import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { promptLog } from "../src/audit/log.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { projectLogKey } from "../src/history/look-back.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { SAMPLES } from "./secret-samples.js";
import { cli, cliJson, field, stdinFrom } from "./support.js";

const repos: Repo[] = [];
const homes: string[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const MASTER = [
  "# Master plan",
  "",
  "## Decisions",
  "",
  "- payment provider: Asaas handles Pix refunds (02-decision-provider.md)",
  "",
  "## Numbers",
  "",
  "- Refund window of 7 days for every order (02-decision-provider.md)",
  "",
].join("\n");

const project = (): Repo => {
  const repo = makeRepo({
    "docs/plan/MASTER.md": MASTER,
    "docs/plan/02-decision-provider.md":
      "# Decision\n\nWebhooks must retry failed deliveries with exponential backoff.\n",
  });
  repos.push(repo);
  return repo;
};

const prompt = async (repo: Repo, text: string, session = "s1") =>
  runHook("UserPromptSubmit", {
    stdin: stdinFrom(
      JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: session, cwd: repo.root, prompt: text }),
    ),
    deadlineMs: 5000,
    handlers: { UserPromptSubmit: [promptLog] },
    cwd: toAbsolutePath(repo.root),
    t: createTranslator("en"),
    startTimer: repoRuntime().startTimer,
    runtime: repoRuntime(),
    env: {},
  });

const transcripts = (
  repo: Repo,
): { env: Readonly<Record<string, string>>; write: (name: string, lines: readonly object[]) => void } => {
  const home = `${repo.root}-claude`;
  homes.push(home);
  const dir = join(home, "projects", projectLogKey(toAbsolutePath(repo.git("rev-parse", "--show-toplevel").trim())));
  mkdirSync(dir, { recursive: true });
  return {
    env: { CLAUDE_CONFIG_DIR: home },
    write: (name, lines) => {
      writeFileSync(join(dir, name), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    },
  };
};

const user = (content: unknown, extra: object = {}) => ({
  type: "user",
  sessionId: "s1",
  timestamp: "2026-10-20T10:00:00.000Z",
  message: { role: "user", content },
  ...extra,
});

describe("finitemonkey audit", () => {
  it("logs only what the person typed, with secrets masked", async () => {
    const repo = project();
    await prompt(repo, `Use this token for the deploy ${SAMPLES.githubPat} and never commit it`);
    await prompt(repo, "<task-notification>subagent finished the refund job</task-notification>");
    await prompt(repo, "[Subagent hand-back] keep the refund window of 30 days");
    const log = repo.read(".finitemonkey/prompts.jsonl");
    const lines = log.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.ok(!log.includes(SAMPLES.githubPat));
    assert.match(log, /never commit it/);
  });

  it("classifies each item as in the master plan, only in a report, lost, contradicted or superseded", async () => {
    const repo = project();
    await prompt(repo, "Use Asaas to handle Pix refunds as the payment provider.");
    await prompt(repo, "Webhooks must retry failed deliveries with exponential backoff.");
    await prompt(repo, "The refund window must be 30 days for every order.");
    await prompt(repo, "Always send the receipt email after checkout.");
    await prompt(repo, "Keep the admin dashboard behind single sign-on.");
    await prompt(repo, "Actually keep the admin dashboard behind single sign-on with two factors.");
    const run = await cliJson(["audit"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 1);
    const items = field(run.body, "data", "items");
    assert.ok(Array.isArray(items));
    const states = items.map((item: unknown) => [
      String(field({ item }, "item", "state")),
      String(field({ item }, "item", "text")).slice(0, 20),
    ]);
    assert.deepEqual(states, [
      ["in_master", "Use Asaas to handle "],
      ["only_report", "Webhooks must retry "],
      ["contradicted", "The refund window mu"],
      ["lost", "Always send the rece"],
      ["superseded", "Keep the admin dashb"],
      ["lost", "Actually keep the ad"],
    ]);
    assert.equal(field(run.body, "data", "source"), "prompts");
  });

  it("falls back to the transcripts without other sessions, subagents or tool results, and opens an incident for a pasted credential", async () => {
    const repo = project();
    const { env, write } = transcripts(repo);
    write("s1.jsonl", [
      user("Always send the receipt email after checkout."),
      user([{ type: "tool_result", tool_use_id: "t1", content: "Always log every request body." }]),
      user("Never store card numbers in the database.", { isSidechain: true }),
      user("Remove the legacy coupon screen from the app.", { sessionId: "other" }),
      user("<command-name>/clear</command-name> remove everything"),
      user(`Use the key ${SAMPLES.githubPat} for the deploy pipeline please`),
    ]);
    const run = await cli(["audit", "--json"], { cwd: repo.root, runtime: repoRuntime(), env });
    assert.ok(!run.stdout.includes(SAMPLES.githubPat));
    const body = JSON.parse(run.stdout) as Record<string, unknown>;
    const texts = (field(body, "data", "items") as readonly unknown[]).map((item) =>
      String(field({ item }, "item", "text")),
    );
    assert.deepEqual(texts.slice(0, 1), ["Always send the receipt email after checkout."]);
    assert.ok(!texts.some((text) => /request body|card numbers|legacy coupon|remove everything/.test(text)));
    const incidents = field(body, "data", "incidents");
    assert.ok(Array.isArray(incidents) && incidents.length === 1);
  });
});
