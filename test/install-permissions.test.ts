import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { ExitCode } from "../src/exit-codes.js";
import { ASK_RULES } from "../src/install/ask-floor.js";
import { claudeignoreRules } from "../src/install/claudeignore.js";
import { DENY_RULES } from "../src/install/deny-floor.js";
import { SETTINGS_FILE } from "../src/install/layout.js";
import { at, repo, run } from "./install-support.js";
import { field, parseBody } from "./support.js";

const permissionsOf = (fs: ReturnType<typeof repo>): unknown =>
  field(parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}"), "permissions");

describe("init permission floor for auto mode", () => {
  it("adds ask rules for pushes to the default branch and deploys, and blocks reads outside the project", async () => {
    const fs = repo();
    assert.equal((await run(fs, ["init", "--yes"])).code, ExitCode.Ok);
    const permissions = permissionsOf(fs);
    assert.deepEqual(field(permissions, "ask"), ASK_RULES);
    assert.equal(field(permissions, "blockReadsOutsideWorkingDirectories"), true);
    assert.ok(ASK_RULES.includes("Bash(git push * main)"));
    assert.ok(ASK_RULES.includes("Bash(npm publish *)"));
    const settings = parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}");
    assert.equal(field(settings, "permissions", "defaultMode"), undefined);
    assert.equal(field(settings, "autoMode"), undefined);
  });

  it("keeps the user's rules and choices and only adds what is missing", async () => {
    const user = {
      permissions: {
        ask: ["Bash(git push * main)", "Bash(make release)"],
        blockReadsOutsideWorkingDirectories: false,
      },
    };
    const fs = repo({ [SETTINGS_FILE]: JSON.stringify(user, null, 2) });
    assert.equal((await run(fs, ["init", "--yes"])).code, ExitCode.Ok);
    const permissions = permissionsOf(fs);
    const ask = field(permissions, "ask");
    assert.ok(Array.isArray(ask));
    assert.deepEqual(ask.slice(0, 2), user.permissions.ask);
    assert.equal(ask.filter((rule) => rule === "Bash(git push * main)").length, 1);
    assert.equal(ask.length, 1 + ASK_RULES.length);
    assert.equal(field(permissions, "blockReadsOutsideWorkingDirectories"), false);
  });

  it("uninstall removes exactly what init added", async () => {
    const original = `${JSON.stringify(
      { permissions: { ask: ["Bash(make release)"], deny: ["Read(./.env)"], allow: ["Bash(ls)"] } },
      null,
      2,
    )}\n`;
    const fs = repo({ [SETTINGS_FILE]: original, ".claudeignore": "secrets/\n" });
    assert.equal((await run(fs, ["init", "--yes"])).code, ExitCode.Ok);
    const permissions = permissionsOf(fs);
    assert.ok(Array.isArray(field(permissions, "deny")));
    const edited = parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}");
    fs.writeAtomic(toAbsolutePath(at(SETTINGS_FILE)), `${JSON.stringify({ ...edited, theme: "dark" }, null, 2)}\n`);
    assert.equal((await run(fs, ["uninstall", "--yes", "--purge"])).code, ExitCode.Ok);
    assert.deepEqual(parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}"), { ...parseBody(original), theme: "dark" });
  });
});

describe(".claudeignore becomes deny rules", () => {
  it("converts gitignore-style patterns into Read rules and skips comments and negations", () => {
    const text = "# notes\nsecrets/\n/build/\ndocs/private/*.md\n*.key\n!keep.key\n\n*\r\n";
    assert.deepEqual(claudeignoreRules([text, undefined]), [
      "Read(secrets/**)",
      "Read(./build/**)",
      "Read(./docs/private/*.md)",
      "Read(*.key)",
    ]);
  });

  it("init adds the converted rules after the floor", async () => {
    const fs = repo({ ".claudeignore": "secrets/\n", ".claude/.claudeignore": "*.key\n" });
    assert.equal((await run(fs, ["init", "--yes"])).code, ExitCode.Ok);
    assert.deepEqual(field(permissionsOf(fs), "deny"), [...DENY_RULES, "Read(secrets/**)", "Read(*.key)"]);
  });
});
