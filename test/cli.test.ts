import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { REGISTRY } from "../src/commands/index.js";
import { commandName } from "../src/commands/types.js";
import { BUNDLE, cli, cliJson, field, TEST_VERSION } from "./support.js";

const names = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value.map((item) => field(item, "name")) : [];

describe("dispatch", () => {
  const versionForms = [["--version"], ["-v"], ["doctor", "--version"]] as const;
  for (const argv of versionForms) {
    it(`${argv.join(" ")} prints the version`, async () => {
      assert.equal((await cli(argv)).stdout, `${TEST_VERSION}\n`);
    });
  }

  it("no command shows help", async () => {
    assert.match((await cli([])).stdout, /Usage: finitemonkey <command>/);
  });

  it("help lists every registered command and marks the planned ones", async () => {
    const { body } = await cliJson(["help"]);
    const commands = field(body, "data", "commands");
    assert.deepEqual(names(commands), REGISTRY.map(commandName));
    const planned = Array.isArray(commands) ? commands.filter((item) => field(item, "status") === "planned") : [];
    assert.deepEqual(names(planned), ["init", "update", "uninstall"]);
    assert.match((await cli(["help"])).stdout, /init {2,}.*\(not available yet\)/);
  });

  const topics = [
    { argv: ["help", "i18n", "check"], text: /finitemonkey i18n check \[--dir <path>\]/ },
    { argv: ["doctor", "--help"], text: /Usage: finitemonkey doctor/ },
    { argv: ["uninstall", "-h"], text: /--purge, --keep-generated/ },
  ] as const;
  for (const { argv, text } of topics) {
    it(`${argv.join(" ")} shows command help`, async () => {
      assert.match((await cli(argv)).stdout, text);
    });
  }

  const unknown = [
    { argv: ["doctr"], fix: "finitemonkey doctor", message: /Did you mean "doctor"/ },
    { argv: ["i18n"], fix: "finitemonkey i18n check", message: /Did you mean "i18n check"/ },
    { argv: ["zzzzzz"], fix: "finitemonkey help", message: /Unknown command "zzzzzz"$/ },
    { argv: ["help", "nope"], fix: "finitemonkey help", message: /Unknown command "nope"/ },
  ] as const;
  for (const { argv, fix, message } of unknown) {
    it(`${argv.join(" ")} explains the error and the fix`, async () => {
      const { code, body } = await cliJson(argv);
      assert.equal(code, 2);
      assert.equal(field(body, "error", "code"), "unknown_command");
      assert.equal(field(body, "error", "fix"), fix);
      assert.match(String(field(body, "error", "message")), message);
    });
  }

  const globalFlags = [
    ["version", "--yes", "--dry-run"],
    ["help", "-y"],
    ["i18n", "check", "--dry-run", "--lang", "es"],
  ] as const;
  for (const argv of globalFlags) {
    it(`accepts global flags: ${argv.join(" ")}`, async () => {
      assert.equal((await cli(argv)).code, 0);
    });
  }

  it("json mode prints exactly one line", async () => {
    assert.equal((await cli(["help", "--json"])).stdout.trim().split("\n").length, 1);
  });
});

describe("bundle", () => {
  it("starts with a shebang and imports only node builtins", () => {
    const text = readFileSync(BUNDLE, "utf8");
    assert.ok(text.startsWith("#!/usr/bin/env node\n"));
    assert.doesNotMatch(text, /from\s+"(?!node:)[^"]+"/);
  });
});
