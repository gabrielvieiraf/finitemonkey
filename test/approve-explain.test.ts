import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { explainCommands } from "../src/approve/effect.js";
import { approvalLine } from "../src/approve/hook.js";
import { createTranslator } from "../src/i18n/translate.js";
import { normalizeCommand } from "../src/shell/normalize.js";
import { fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo } from "./repo.js";
import { parseBody } from "./support.js";

const t = createTranslator("en");
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const explain = (text: string, repoRoot: string | undefined = "/work/app") =>
  explainCommands(normalizeCommand(text).commands, { cwd: "/work/app", repoRoot });

const lineOf = (text: string): string => approvalLine(t, explain(text), "long");

describe("plain-language effect before an approval", () => {
  it("says rm -rf inside the repository deletes and is undoable with undo", () => {
    assert.deepEqual(explain("rm -rf build/"), { effect: "deletes", reversal: "undo" });
    assert.match(lineOf("rm -rf build/"), /deletes.*undoable with undo/);
  });

  it("says rm -rf outside a repository is not undoable", () => {
    assert.deepEqual(explain("rm -rf /tmp/cache", undefined), { effect: "deletes", reversal: "none" });
  });

  it("says a curl POST to an external host sends out of the machine and names the host", () => {
    const found = explain("curl -X POST -d @payload.json https://api.example.com/v1/items");
    assert.deepEqual(found, { effect: "sends", reversal: "none", host: "api.example.com" });
    assert.match(approvalLine(t, found, "short"), /sends out of the machine to api\.example\.com/);
    assert.equal(explain("curl --data x=1 http://localhost:3000/hook").effect, "changes");
  });

  it("shows effect unknown for a command it cannot classify", () => {
    assert.equal(explain("frobnicate --all").effect, "unknown");
    assert.equal(explain("ls && frobnicate").effect, "unknown");
    assert.match(lineOf("frobnicate --all"), /effect unknown/);
  });

  it("yields the same line for the same command, and the level only changes the wording", () => {
    const command = "git push origin main";
    assert.equal(lineOf(command), lineOf(command));
    const found = explain(command);
    assert.equal(found.effect, "sends");
    assert.match(approvalLine(t, found, "short"), /^sends out of the machine to origin; not undoable$/);
  });

  it("reads stay reads and a write redirect is a change", () => {
    assert.deepEqual(explain("cat README.md | grep foo"), { effect: "reads", reversal: "self" });
    assert.equal(explain("echo hi > notes.txt").effect, "changes");
  });
});

describe("explain-approval hook", () => {
  const setup = (mode: string): Repo => {
    const repo = makeRepo({ ".finitemonkey/policy.yml": policyWith({ "explain-approval": mode }) });
    repos.push(repo);
    return repo;
  };
  const payload = { tool_name: "Bash", tool_input: { command: "rm -rf build/" } };

  it("shows the line on a permission prompt when active", async () => {
    const repo = setup("active");
    const outcome = await fireHook(repo, "PermissionRequest", payload);
    assert.match(String(parseBody(outcome.stdout)["systemMessage"]), /deletes.*undoable with undo/);
  });

  it("only logs the line in shadow, without the command text", async () => {
    const repo = setup("shadow");
    const outcome = await fireHook(repo, "PermissionRequest", payload);
    assert.equal(outcome.stdout.trim() === "" || parseBody(outcome.stdout)["systemMessage"] === undefined, true);
    const log = repo.read(".finitemonkey/log.jsonl");
    assert.match(log, /"feature":"explain-approval".*"effect":"deletes".*"reversal":"undo"/);
    assert.doesNotMatch(log, /rm -rf/);
  });
});
