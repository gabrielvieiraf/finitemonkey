import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import type { HookInput } from "../src/hooks/handlers.js";
import { parseHookPayload } from "../src/hooks/payload.js";
import { createTranslator } from "../src/i18n/translate.js";
import { POLICY_FILE } from "../src/policy/policy.js";
import { recapBrief, recapBriefLines } from "../src/recap/brief.js";
import { fromDistTags, packageName } from "../src/stale/registry.js";
import { resolveUnits } from "../src/stale/resolve.js";
import { localState } from "../src/stale/state.js";
import { staleDocsStop } from "../src/stale/stop.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { execResult } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const repo = (files: Readonly<Record<string, string>>): Repo => {
  const made = makeRepo(files);
  repos.push(made);
  return made;
};

const t = createTranslator("en");

const stopInput = (target: Repo, runtime: Runtime = repoRuntime(), active = false): HookInput => {
  const text = JSON.stringify({ hook_event_name: "Stop", cwd: target.root, stop_hook_active: active });
  const parsed = parseHookPayload("Stop", text, false);
  assert.ok(parsed.ok);
  return { event: "Stop", payload: parsed.value, cwd: target.root, runtime, t, env: {} };
};

const systemMessage = async (input: HookInput): Promise<string> => {
  const decision = await staleDocsStop(input);
  assert.equal(decision.kind, "allow");
  const message = decision.output?.["systemMessage"];
  return typeof message === "string" ? message : "";
};

const FILES = {
  "src/app.ts": "export const app = 1;\n",
  "docs/app.md": "The entry point is src/app.ts.\n",
  "docs/other.md": "Nothing about code here.\n",
};

const editedRepo = (mode: string | undefined): Repo => {
  const target = repo({
    ...FILES,
    ...(mode === undefined ? {} : { [POLICY_FILE]: `guards:\n  stale-docs: ${mode}\n` }),
  });
  target.write(".finitemonkey/state.json", '{"schemaVersion":1,"done":[]}\n');
  target.write("src/app.ts", "export const app = 2;\n");
  return target;
};

describe("stale docs at task end", () => {
  it("lists the docs that mention what the task changed, once, when active", async () => {
    const target = editedRepo("active");
    const message = await systemMessage(stopInput(target));
    assert.match(
      message,
      /^finitemonkey: Doc lines that mention what this task changed and were not updated in it \(1;/,
    );
    assert.match(message, /docs\/app\.md:1 mentions src\/app\.ts/);
    assert.doesNotMatch(message, /other\.md/);
    assert.equal(await systemMessage(stopInput(target)), "");
  });

  it("starts in shadow: shows nothing and logs what it would have listed", async () => {
    const target = editedRepo(undefined);
    assert.equal(await systemMessage(stopInput(target)), "");
    const logged = target
      .read(".finitemonkey/log.jsonl")
      .split("\n")
      .filter((line) => line.includes('"feature_shadow"'));
    assert.equal(logged.length, 1);
    assert.match(logged[0] ?? "", /"feature":"stale-docs","mentions":1,"files":\["docs\/app\.md"\]/);
  });

  it("leaves out a doc the task already updated and stays quiet on a second stop of the same turn", async () => {
    const target = editedRepo("active");
    target.write("docs/app.md", "The entry point is src/app.ts, now at version 2.\n");
    assert.equal(await systemMessage(stopInput(target)), "");
    const other = editedRepo("active");
    assert.equal(await systemMessage(stopInput(other, repoRuntime(), true)), "");
  });

  it("never blocks, even with nothing to diff against", async () => {
    const target = repo({});
    target.write(".finitemonkey/state.json", '{"schemaVersion":1,"done":[]}\n');
    assert.deepEqual(await staleDocsStop(stopInput(target)), { kind: "allow" });
  });
});

const npmRuntime = (calls: ExecRequest[], stdout: string, code = 0): Runtime => {
  const base = repoRuntime();
  return {
    ...base,
    exec: (request) => {
      calls.push(request);
      return request.command === "npm" ? execResult(code, stdout) : base.exec(request);
    },
  };
};

const NOT_PUBLISHED = "Nothing installs yet: the package is not on npm.\n";
const PACKAGE = '{"name":"acme-tool","version":"0.0.0"}\n';
const CHANGELOG = "# Changelog\n\n## [0.1.0](https://example.com) (2026-10-01)\n";
const ISSUES = new Map();

describe("published version from the npm registry", () => {
  it("prefers latest, then next, then any dist-tag", () => {
    assert.deepEqual(fromDistTags('{"next":"0.2.0-next.3","latest":"0.1.0"}'), {
      version: "0.1.0",
      source: "registry",
      tag: "latest",
    });
    assert.equal(fromDistTags('{"next":"0.2.0-next.3"}')?.tag, "next");
    assert.equal(fromDistTags('{"beta":"0.3.0-beta.1"}')?.version, "0.3.0-beta.1");
    assert.equal(fromDistTags("{}"), undefined);
    assert.equal(fromDistTags("npm ERR! 404"), undefined);
  });

  it("asks the registry only when online and reports the dist-tag as evidence", () => {
    const target = repo({ "package.json": PACKAGE, "README.md": NOT_PUBLISHED });
    const calls: ExecRequest[] = [];
    const runtime = npmRuntime(calls, '{"next":"0.2.0-next.3"}');
    const offline = localState(runtime, target.root, [], undefined);
    assert.equal(offline.published, undefined);
    assert.equal(calls.length, 0);
    const online = localState(runtime, target.root, [], ISSUES);
    assert.deepEqual(calls[0]?.args, ["view", "acme-tool", "dist-tags", "--json"]);
    const claims = resolveUnits([{ file: "README.md", line: 1, text: NOT_PUBLISHED.trim() }], online).stale;
    assert.deepEqual(
      claims.map((claim) => [claim.subject, claim.detail, claim.evidence]),
      [["registry", "0.2.0-next.3", "the npm registry lists 0.2.0-next.3 under the dist-tag next"]],
    );
  });

  it("falls back to the changelog when the registry cannot answer", () => {
    const target = repo({ "package.json": PACKAGE, "CHANGELOG.md": CHANGELOG });
    const state = localState(npmRuntime([], "", 1), target.root, [], ISSUES);
    assert.deepEqual(state.published, { version: "0.1.0", source: "changelog" });
  });

  it("does not ask about a private package", () => {
    const target = repo({ "package.json": '{"name":"app","private":true}\n' });
    assert.equal(packageName(repoRuntime(), target.root), undefined);
  });
});

describe("recap line on the resume card", () => {
  it("counts changes shipped in the last 7 days and says nothing when there are none", () => {
    const target = repo({ "src/a.ts": "export const a = 1;\n" });
    const runtime = repoRuntime();
    const paths = fmPaths(target.root);
    assert.deepEqual(recapBriefLines(t, recapBrief(runtime, paths)), []);
    target.write("src/a.ts", "export const a = 2;\n");
    target.commit("feat: bigger a");
    target.write("src/a.ts", "export const a = 3;\n");
    target.commit("chore: tidy");
    assert.deepEqual(recapBriefLines(t, recapBrief(runtime, paths)), [
      "Last 7 days: 0 tasks finished, 1 changes shipped. `finitemonkey recap` lists them.",
    ]);
  });
});
