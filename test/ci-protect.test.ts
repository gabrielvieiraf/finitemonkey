import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { rulesetFor } from "../src/ci/protect/plan.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { checkGithubSettings } from "../src/doctor/github-settings.js";
import { cli, cliJson, execResult, fakeRuntime, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const at = (path: string): string => toAbsolutePath(path, ROOT);
const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

interface FakeGh {
  readonly rules?: readonly unknown[] | undefined;
  readonly scanning?: "enabled" | "disabled";
  readonly alerts?: boolean;
  readonly writes?: boolean;
}

const fakeGh =
  (calls: ExecRequest[], options: FakeGh = {}) =>
  (request: ExecRequest) => {
    if (request.command !== "gh") return undefined;
    calls.push(request);
    const args = request.args.join(" ");
    if (args.includes("--method")) return execResult(options.writes === false ? 1 : 0, "{}");
    if (args.startsWith("repo view"))
      return execResult(
        0,
        JSON.stringify({ nameWithOwner: "acme/app", defaultBranchRef: { name: "main" }, visibility: "PUBLIC" }),
      );
    if (args === "api repos/acme/app/rulesets")
      return execResult(
        0,
        JSON.stringify(options.rules === undefined ? [] : [{ id: 7, name: "finitemonkey: protected default branch" }]),
      );
    if (args === "api repos/acme/app/rulesets/7") return execResult(0, JSON.stringify({ rules: options.rules ?? [] }));
    if (args === "api repos/acme/app") {
      const status = options.scanning ?? "disabled";
      return execResult(
        0,
        JSON.stringify({
          security_and_analysis: { secret_scanning: { status }, secret_scanning_push_protection: { status } },
        }),
      );
    }
    if (args === "api repos/acme/app/vulnerability-alerts")
      return execResult(options.alerts === true ? 0 : 1, "", "Not Found");
    return execResult(1, "", "unexpected");
  };

const writesIn = (calls: readonly ExecRequest[]): readonly string[] =>
  calls.filter((call) => call.args.includes("--method")).map((call) => call.args.join(" "));

const runtimeWith = (calls: ExecRequest[], options: FakeGh = {}, files: Readonly<Record<string, string>> = {}) =>
  fakeRuntime({
    exec: fakeGh(calls, options),
    files: Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
  });

describe("ci protect", () => {
  it("shows current and proposed values and changes nothing without the yes", async () => {
    const calls: ExecRequest[] = [];
    const run = await cliJson(["ci", "protect"], { runtime: runtimeWith(calls), cwd: ROOT, stdin: tty() });
    assert.equal(run.code, 0);
    assert.deepEqual(writesIn(calls), []);
    const changes = field(run.body, "data", "changes");
    assert.ok(Array.isArray(changes));
    const ruleset: unknown = changes.find((change: unknown) => field(change, "setting") === "ruleset");
    assert.equal(field(ruleset, "current"), "none");
    assert.match(String(field(ruleset, "proposed")), /required_status_checks \(finitemonkey ci gate\)/);
    const scanning: unknown = changes.find((change: unknown) => field(change, "setting") === "secret-scanning");
    assert.deepEqual([field(scanning, "current"), field(scanning, "proposed")], ["disabled", "enabled"]);
    assert.equal(field(run.body, "next"), "finitemonkey ci protect --yes");
  });

  for (const [label, env, stdin] of [
    ["without a terminal", {}, undefined],
    ["inside Claude Code", { CLAUDECODE: "1" }, tty()],
  ] as const) {
    it(`an agent's --yes ${label} changes nothing on GitHub`, async () => {
      const calls: ExecRequest[] = [];
      const run = await cli(["ci", "protect", "--yes"], {
        runtime: runtimeWith(calls),
        cwd: ROOT,
        env,
        ...(stdin === undefined ? {} : { stdin }),
      });
      assert.equal(run.code, 4);
      assert.deepEqual(writesIn(calls), []);
    });
  }

  it("the person's yes in a terminal applies each change and records it", async () => {
    const calls: ExecRequest[] = [];
    const runtime = runtimeWith(calls);
    const run = await cli(["ci", "protect", "--yes"], { runtime, cwd: ROOT, stdin: tty() });
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.deepEqual(writesIn(calls), [
      "api --method POST repos/acme/app/rulesets --input -",
      "api --method PATCH repos/acme/app --input -",
      "api --method PATCH repos/acme/app --input -",
      "api --method PUT repos/acme/app/vulnerability-alerts",
    ]);
    const posted = calls.find((call) => call.args.includes("POST"))?.input ?? "";
    assert.match(posted, /"name":"finitemonkey: protected default branch"/);
    const log = runtime.readText(toAbsolutePath(at(".finitemonkey/ci-protect.jsonl")));
    assert.ok(log.ok);
    assert.equal(log.value.trim().split("\n").length, 4);
    assert.match(log.value, /"setting":"secret-scanning","current":"disabled","proposed":"enabled","ok":true/);
  });

  it("updates its own ruleset in place and skips settings that are already on", async () => {
    const calls: ExecRequest[] = [];
    const run = await cli(["ci", "protect", "--yes"], {
      runtime: runtimeWith(calls, { rules: [{ type: "deletion" }], scanning: "enabled", alerts: true }),
      cwd: ROOT,
      stdin: tty(),
    });
    assert.equal(run.code, 0);
    assert.deepEqual(writesIn(calls), ["api --method PUT repos/acme/app/rulesets/7 --input -"]);
  });

  it("reports a change GitHub refused and exits 1", async () => {
    const calls: ExecRequest[] = [];
    const run = await cli(["ci", "protect", "--yes"], {
      runtime: runtimeWith(calls, { writes: false }),
      cwd: ROOT,
      stdin: tty(),
    });
    assert.equal(run.code, 1);
  });

  it("says so when gh cannot read the repository", async () => {
    const run = await cli(["ci", "protect"], { runtime: fakeRuntime(), cwd: ROOT });
    assert.equal(run.code, 3);
  });

  it("takes the ruleset from the git level", () => {
    const types = (level: "beginner" | "intermediate" | "advanced") => JSON.stringify(rulesetFor(level));
    assert.match(types("beginner"), /"required_approving_review_count":1/);
    assert.match(types("intermediate"), /"required_approving_review_count":0,"require_code_owner_review":true/);
    assert.doesNotMatch(types("advanced"), /pull_request/);
  });

  it("lists the paths CODEOWNERS leaves without owner", async () => {
    const calls: ExecRequest[] = [];
    const runtime = runtimeWith(
      calls,
      {},
      { ".github/CODEOWNERS": "/.github/workflows/ @acme/ops\n", "prisma/migrations/x.sql": "" },
    );
    const run = await cliJson(["ci", "protect"], { runtime, cwd: ROOT });
    assert.deepEqual(field(run.body, "data", "codeowners", "missing"), [
      "/infra/",
      "/prisma/migrations/",
      "/.github/CODEOWNERS",
    ]);
  });

  it("doctor reports the missing settings from what ci protect read", async () => {
    const calls: ExecRequest[] = [];
    const runtime = runtimeWith(calls);
    await cli(["ci", "protect"], { runtime, cwd: ROOT });
    const keys = checkGithubSettings({
      platform: "linux",
      env: {},
      cwd: ROOT,
      root: ROOT,
      version: "1.0.0",
      runtime,
    }).map((item) => item.messageKey);
    assert.deepEqual(keys, [
      "doctor.github.secret_scanning_off",
      "doctor.github.push_protection_off",
      "doctor.github.dependabot_alerts_off",
      "doctor.github.no_protect_ruleset",
    ]);
  });
});
