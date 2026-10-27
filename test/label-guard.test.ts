import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { GUARD_SETS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { findLabels } from "../src/planta/labels.js";
import { withPolicy } from "../src/policy/guards.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, parseBody, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SCREENS = {
  "index.html": '<!doctype html><html><body><div id="root"></div></body></html>\n',
  "src/Login.tsx": "export const Login = () => <form><input /><button>Sign in</button></form>;\n",
  "src/Dashboard.tsx": "export const Dashboard = () => <main><h1>MRR</h1></main>;\n",
  "src/style.css": "main { display: grid; }\n",
};

const BACKEND = {
  ...SCREENS,
  "package.json": '{"dependencies":{"next-auth":"5.0.0","stripe":"17.0.0"}}\n',
  "src/api/invoices.ts": "export const list = () => [];\n",
  "migrations/001_init.sql": "create table accounts (id serial primary key);\n",
};

const LABEL_SET = GUARD_SETS.find((set) => set.id === "label");

const project = async (files: Readonly<Record<string, string>>, blueprint?: string): Promise<Repo> => {
  const repo = makeRepo(files);
  repos.push(repo);
  const runtime = repoRuntime();
  await cliJson(["task", "new", "t1", "--goal", "invoice SaaS"], { cwd: repo.root, runtime });
  if (blueprint !== undefined) await cliJson(["planta", blueprint], { cwd: repo.root, runtime });
  return repo;
};

const stop = (repo: Repo, message: string, lang: "en" | "pt-BR" = "en", active = false): Promise<HookOutcome> => {
  const runtime = repoRuntime();
  assert.ok(LABEL_SET !== undefined);
  return runHook("Stop", {
    stdin: stdinFrom(
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: "s1",
        cwd: repo.root,
        stop_hook_active: active,
        last_assistant_message: message,
      }),
    ),
    deadlineMs: 20_000,
    handlers: withPolicy(LABEL_SET),
    cwd: repo.root,
    t: createTranslator(lang),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const reasonOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const body = parseBody(outcome.stdout);
  return field(body, "decision") === "block" ? String(field(body, "reason")) : "";
};

describe("label guard: blocks a label the blueprint does not support", () => {
  it('blocks "SaaS ready" on a screens-only project and says what it is', async () => {
    const repo = await project(SCREENS, "saas");
    const outcome = await stop(repo, "Your SaaS is ready! The login and dashboard screens are done.");
    assert.equal(outcome.verdict, "block");
    const reason = reasonOf(outcome);
    assert.match(reason, /uses the label "saas"/);
    assert.match(reason, /a screen prototype/);
    assert.match(reason, /API separate from the screens; Database with migrations; Accounts and sign-in; Billing/);
  });

  it('blocks "SaaS pronto" in Portuguese with the message in Portuguese', async () => {
    const repo = await project(SCREENS, "saas");
    const outcome = await stop(repo, "SaaS pronto: telas de login e dashboard.", "pt-BR");
    assert.match(reasonOf(outcome), /um protótipo de tela/);
    assert.match(reasonOf(outcome), /Banco com migrações/);
  });

  it('blocks "production ready" when the production minimum is missing', async () => {
    const repo = await project(BACKEND, "saas");
    const outcome = await stop(repo, "The app is production ready.");
    assert.match(reasonOf(outcome), /uses the label "production"/);
    assert.match(reasonOf(outcome), /Tested backup/);
  });

  it("lets the label through when the minimum items are green", async () => {
    const repo = await project(BACKEND, "saas");
    const outcome = await stop(repo, "Your SaaS is ready: accounts, billing and the invoices API work.");
    assert.equal(reasonOf(outcome), "");
    assert.equal(outcome.verdict, "allow");
  });
});

describe("label guard: does not fire on ordinary messages", () => {
  it('"Done, I read the file" in a task without a blueprint does not fire', async () => {
    const repo = await project(SCREENS);
    const outcome = await stop(repo, "Done, I read the file.");
    assert.equal(outcome.verdict, "allow");
    assert.equal(reasonOf(outcome), "");
  });

  it('"Done, I read the file" does not fire even with a blueprint', async () => {
    const repo = await project(SCREENS, "saas");
    assert.equal(reasonOf(await stop(repo, "Done, I read the file.")), "");
  });

  it("a SaaS claim in a task without a blueprint does not fire", async () => {
    const repo = await project(SCREENS);
    assert.equal(reasonOf(await stop(repo, "Your SaaS is ready!")), "");
  });

  it("finds labels in the three languages and ignores mentions", () => {
    const labels = (text: string): readonly string[] => findLabels(text).map((hit) => hit.label);
    assert.deepEqual(labels("Tu SaaS está listo."), ["saas", "done"]);
    assert.deepEqual(labels("O app está pronto para produção."), ["production", "done"]);
    assert.deepEqual(labels("Pronto, li o arquivo."), []);
    assert.deepEqual(labels("Added the SaaS pricing section to the page."), []);
  });
});

describe("label guard: false positives and the block ceiling", () => {
  it("logs each block, and a false positive recorded by the person", async () => {
    const repo = await project(SCREENS, "saas");
    await stop(repo, "Your SaaS is ready!");
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"event":"label.block","task":"t1","label":"saas"/);
    const stdin = Object.assign(stdinFrom(""), { isTTY: true });
    const recorded = await cliJson(["policy", "false-positive", "label"], {
      cwd: repo.root,
      runtime: repoRuntime(),
      stdin,
    });
    assert.equal(recorded.code, 0, recorded.stdout);
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"event":"guard_false_positive","guard":"label"/);
  });

  it("in shadow it records what it would block instead of blocking", async () => {
    const repo = await project(SCREENS, "saas");
    repo.write(".finitemonkey/policy.yml", "level: standard\n");
    const outcome = await stop(repo, "Your SaaS is ready!");
    assert.equal(outcome.verdict, "allow");
    assert.match(repo.read(".finitemonkey/log.jsonl"), /"event":"guard_shadow","guard":"label"/);
  });

  it("stops blocking after the same label is held three times in a row", async () => {
    const repo = await project(SCREENS, "saas");
    const message = "Your SaaS is ready!";
    assert.equal((await stop(repo, message)).verdict, "block");
    assert.equal((await stop(repo, message, "en", true)).verdict, "block");
    assert.equal((await stop(repo, message, "en", true)).verdict, "block");
    const fourth = await stop(repo, message, "en", true);
    assert.equal(fourth.verdict, "allow");
    assert.match(fourth.stdout, /held too many times in a row/);
  });
});
