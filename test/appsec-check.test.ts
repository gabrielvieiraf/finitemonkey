import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import { semgrepRules } from "../src/appsec/semgrep.js";
import { detectStack } from "../src/appsec/stack.js";
import type { TextSource } from "../src/core/context.js";
import { appsecCheck } from "../src/gate/checks/appsec.js";
import { prepareGate } from "../src/gate/prepare.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { implicitContract } from "../src/task/implicit.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, ROOT, stdinFrom } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });
const fixture = (rule: string, kind: string): string =>
  readFileSync(join(ROOT, "test", "fixtures", "appsec", rule, `${kind}.ts.txt`), "utf8");

const PACKAGE = JSON.stringify({ dependencies: { next: "15.0.0", "@prisma/client": "6.0.0" } });

const webRepo = (): Repo => {
  const repo = makeRepo({
    "package.json": PACKAGE,
    "app/api/invoices/route.ts": fixture("route-auth", "vulnerable"),
    "app/api/health/route.ts": fixture("route-auth", "fixed"),
  });
  repos.push(repo);
  return repo;
};

const findingsOf = (body: unknown): readonly unknown[] => {
  const list = field(body, "data", "findings");
  return Array.isArray(list) ? list : [];
};

describe("appsec scan with the findings baseline", () => {
  it("maps each finding to its OWASP Top 10 id in the output", async () => {
    const repo = webRepo();
    const run = await cliJson(["appsec", "scan"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 1);
    const [first] = findingsOf(run.body);
    assert.equal(field(first, "rule"), "route-auth");
    assert.equal(field(first, "owasp"), "A01");
    assert.equal(field(first, "owaspName"), "A01:2021 Broken Access Control");
    assert.equal(field(first, "status"), "new");
    assert.match(run.stderr + run.stdout, /A01:2021 Broken Access Control/);
  });

  it("old findings go to the baseline; a new one blocks", async () => {
    const repo = webRepo();
    const runtime = repoRuntime();
    const byModel = await cliJson(["appsec", "scan", "--accept-existing", "--reason", "x"], {
      cwd: repo.root,
      runtime,
      env: { CLAUDECODE: "1" },
    });
    assert.equal(byModel.code, 4);
    const adopted = await cliJson(["appsec", "scan", "--accept-existing", "--reason", "code before adoption"], {
      cwd: repo.root,
      runtime,
      stdin: tty(),
    });
    assert.equal(adopted.code, 0, adopted.stdout);
    assert.equal(field(adopted.body, "data", "accepted"), 1);
    assert.equal((await cliJson(["appsec", "scan"], { cwd: repo.root, runtime })).code, 0);
    repo.write("app/api/orders/route.ts", fixture("route-auth", "vulnerable").replace("invoice", "order"));
    const later = await cliJson(["appsec", "scan"], { cwd: repo.root, runtime });
    assert.equal(later.code, 1);
    assert.deepEqual(
      findingsOf(later.body).map((item) => [field(item, "file"), field(item, "status")]),
      [
        ["app/api/invoices/route.ts", "known"],
        ["app/api/orders/route.ts", "new"],
      ],
    );
  });

  it("a route listed in routes-public.yml with a reason passes", async () => {
    const repo = webRepo();
    repo.write(".finitemonkey/routes-public.yml", "routes:\n  - route: /api/invoices\n    reason: public price list\n");
    const run = await cliJson(["appsec", "scan"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 0, run.stdout);
  });
});

describe("appsec check at Stop", () => {
  const gate = (repo: Repo) => {
    const ready = prepareGate({
      runtime: repoRuntime(),
      cwd: repo.root,
      env: {},
      sessionId: undefined,
      budgetMs: 5000,
      fast: false,
      noSkip: true,
    });
    if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
    return appsecCheck({ id: "appsec", kind: "appsec" }, ready.prepared.ctx);
  };

  it("fails a new finding in the changed files, and only warns at policy level light", () => {
    const repo = webRepo();
    repo.write("app/api/orders/route.ts", fixture("route-auth", "vulnerable"));
    const outcome = gate(repo);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      outcome.notes.map((item) => [item.key, item.params["file"], item.params["owasp"]]),
      [["gate.appsec.finding", "app/api/orders/route.ts", "A01:2021 Broken Access Control"]],
    );
    repo.write(".finitemonkey/policy.yml", "level: light\n");
    assert.equal(gate(repo).status, "passed");
  });

  it("is part of the contract only for a detected web stack", () => {
    const files = (pkg: string) => ({
      read: (path: string) => (path === "package.json" ? pkg : undefined),
      exists: () => false,
    });
    const kinds = (pkg: string) => implicitContract(files(pkg)).acceptance.map((check) => check.kind);
    assert.ok(kinds(PACKAGE).includes("appsec"));
    assert.ok(!kinds(JSON.stringify({ dependencies: { chalk: "5.0.0" } })).includes("appsec"));
  });
});

describe("light rules warn on edit", () => {
  it("warns about the finding an edit adds and lets it through", async () => {
    const repo = webRepo();
    const runtime = repoRuntime();
    const outcome: HookOutcome = await runHook("PreToolUse", {
      stdin: stdinFrom(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "s1",
          cwd: repo.root,
          tool_name: "Write",
          tool_input: {
            file_path: join(repo.root, "src", "server.ts"),
            content: fixture("cors-credentials", "vulnerable"),
          },
        }),
      ),
      deadlineMs: 5000,
      handlers: DEFAULT_HANDLERS,
      cwd: repo.root,
      t: createTranslator("en"),
      startTimer: runtime.startTimer,
      runtime,
    });
    assert.equal(outcome.verdict, "allow");
    assert.match(
      outcome.stdout,
      /CORS allows any origin together with credentials \(A05:2021 Security Misconfiguration\)/,
    );
  });
});

describe("semgrep rules for CI", () => {
  it("are generated for the detected stack with the OWASP id in each rule", () => {
    const js = semgrepRules(detectStack((path) => (path === "package.json" ? PACKAGE : undefined)));
    assert.match(js, /id: finitemonkey\.sql-concat-js/);
    assert.match(js, /owasp: "A03:2021 Injection"|owasp: A03:2021 Injection/);
    assert.doesNotMatch(js, /sql-concat-py/);
    const py = semgrepRules(
      detectStack((path) => (path === "requirements.txt" ? "fastapi==0.115\nsqlalchemy\n" : undefined)),
    );
    assert.match(py, /finitemonkey\.cors-credentials-py/);
  });
});
