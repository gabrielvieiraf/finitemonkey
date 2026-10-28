import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { evaluateTrigger } from "../src/debt/trigger.js";
import { contractHash, parseContract } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, readTrust, writeState, writeTrust } from "../src/task/state.js";
import { validateContract } from "../src/task/validate.js";
import { makeRepo, NO_PR, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, fakeRuntime, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const CONTRACT = {
  id: "t1",
  goal: "checkout with Pix",
  acceptance: [
    { id: "A1", check: "command", run: "node -e 0" },
    { id: "A2", check: "manual", description: "refund flow reviewed by finance" },
  ],
};

const issuesOf = (shortcuts: unknown): readonly string[] => {
  const result = validateContract({ ...CONTRACT, shortcuts });
  return result.ok ? [] : result.error;
};

const activate = (repo: Repo, text: string): void => {
  const parsed = parseContract("t1", text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  runtime.writeText(paths.task("t1"), text);
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, t1: contractHash(parsed.value) },
    approved: { ...lock.approved, t1: text },
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: "t1" });
};

describe("shortcuts in the contract", () => {
  it("accepts shortcuts for the how and rejects an acceptance criterion turned into a shortcut", () => {
    assert.deepEqual(
      issuesOf([
        { what: "tax rate hardcoded at 5%", ceiling: "one state", trigger: "date:2027-01-01", where: "src/tax.ts" },
      ]),
      [],
    );
    assert.match(
      issuesOf([{ what: "skip A2 until next sprint" }]).join("\n"),
      /never its scope; "A2" is an acceptance check/,
    );
    assert.match(
      issuesOf([{ what: "no refund flow reviewed by finance yet" }]).join("\n"),
      /"A2" is an acceptance check/,
    );
    assert.match(issuesOf([{ ceiling: "x" }]).join("\n"), /shortcuts\[0\]\.what: required/);
  });

  it("detects expired triggers from a date and from a command count", () => {
    const runtime = fakeRuntime({ now: "2026-10-27T12:00:00.000Z" });
    const root = toAbsolutePath("/home/ana/project");
    assert.equal(evaluateTrigger(runtime, root, "date:2026-10-01").state, "expired");
    assert.equal(evaluateTrigger(runtime, root, "date:2026-12-01").state, "waiting");
    assert.equal(evaluateTrigger(runtime, root, undefined).state, "no-trigger");
    const repo = makeRepo({ ".finitemonkey/config.yml": 'debt:\n  counts:\n    users: node -e "console.log(120)"\n' });
    repos.push(repo);
    assert.deepEqual(evaluateTrigger(repoRuntime(), repo.root, "count:users > 100"), {
      state: "expired",
      detail: "users = 120 (> 100)",
    });
    assert.equal(evaluateTrigger(repoRuntime(), repo.root, "count:users > 500").state, "waiting");
    assert.equal(evaluateTrigger(repoRuntime(), repo.root, "count:missing > 1").state, "unreadable");
  });

  it("task done lists shortcuts without a trigger and debt lists them across tasks", async () => {
    const repo = makeRepo({
      "src/tax.js": "// shortcut: tax table copied by hand trigger: date:2026-01-01\nexport const tax = 5;\n",
      ".finitemonkey/config.yml": "preset: neutral\n",
    });
    repos.push(repo);
    activate(
      repo,
      [
        "id: t1",
        "goal: checkout",
        "acceptance:",
        "  - id: A1",
        "    check: command",
        "    run: node -e 0",
        "shortcuts:",
        "  - what: polling instead of webhooks",
        "    ceiling: 100 orders a day",
        "    where: src/poll.js",
        "  - what: in-memory cache",
        "    trigger: date:2026-01-15",
        "",
      ].join("\n"),
    );
    const done = await cli(["task", "done"], { cwd: repo.root, runtime: repoRuntime({ gh: NO_PR }) });
    assert.equal(done.code, 0, done.stdout + done.stderr);
    assert.match(done.stdout, /Shortcut without a trigger to revisit it: polling instead of webhooks/);
    assert.doesNotMatch(done.stdout, /revisit it: in-memory cache/);
    const debt = await cliJson(["debt"], {
      cwd: repo.root,
      runtime: repoRuntime({ now: () => "2026-10-27T12:00:00.000Z" }),
    });
    const items = field(debt.body, "data", "items");
    assert.ok(Array.isArray(items));
    assert.deepEqual(
      items.map((item: unknown) => [
        field({ item }, "item", "source"),
        field({ item }, "item", "what"),
        field({ item }, "item", "state"),
      ]),
      [
        ["closed", "polling instead of webhooks", "no-trigger"],
        ["closed", "in-memory cache", "expired"],
        ["marker", "tax table copied by hand", "expired"],
      ],
    );
  });
});
