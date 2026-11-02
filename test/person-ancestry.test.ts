import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  claudeAncestor,
  isClaudeCommand,
  nodeAncestors,
  parseProcStat,
  parsePsTable,
  walkAncestors,
} from "../src/core/ancestry.js";
import type { AncestorInfo } from "../src/core/runtime.js";
import { cli, fakeRuntime, ROOT } from "./support.js";

const tty = (): Readable => Object.assign(Readable.from([]), { isTTY: true });

const CLAUDE: readonly AncestorInfo[] = [
  { pid: 4100, command: "-zsh" },
  { pid: 4000, command: "claude --resume" },
  { pid: 10, command: "/sbin/init" },
];

describe("process ancestry", () => {
  it("reads the parent pid from /proc stat even when the name has spaces and parentheses", () => {
    assert.equal(parseProcStat("4321 (my (odd) proc) S 4000 4321 4321 0 -1"), 4000);
  });

  it("parses the ps table and walks up to init without looping", () => {
    const table = parsePsTable("  4200  4100 node cli.js\n  4100  4000 -zsh\n  4000     1 claude\n");
    assert.deepEqual(
      walkAncestors(4200, (pid) => table.get(pid)).map((row) => row.command),
      ["node cli.js", "-zsh", "claude"],
    );
    assert.equal(walkAncestors(7, () => ({ ppid: 7, command: "x" })).length, 1);
  });

  it("recognizes the Claude Code executable and its package, and not files or other programs named like it", () => {
    for (const command of [
      "claude",
      "/home/ana/.claude/local/claude --print",
      "node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js",
      "C:\\Users\\ana\\AppData\\Roaming\\npm\\claude.exe",
    ]) {
      assert.ok(isClaudeCommand(command), command);
    }
    for (const command of ["vim claude.md", "claude-desktop-helper", "-zsh", "node scripts/claudes.js"]) {
      assert.ok(!isClaudeCommand(command), command);
    }
  });
});

describe("person-only commands and process ancestry", () => {
  it("a person-only command spawned under a Claude Code ancestor is refused even with a terminal and no Claude Code variables", async () => {
    const refused = await cli(["off", "--json"], { stdin: tty(), runtime: fakeRuntime({ ancestors: CLAUDE }) });
    assert.notEqual(refused.code, 0);
    assert.match(refused.stdout, /needs_person|person/);
    const allowed = await cli(["off", "--json"], {
      stdin: tty(),
      runtime: fakeRuntime({ ancestors: CLAUDE.slice(0, 1) }),
    });
    assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
  });

  it(
    "finds a real ancestor started as claude on Linux and macOS",
    { skip: process.platform !== "linux" && process.platform !== "darwin" },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "fm-ancestry-"));
      try {
        const probe = join(dir, "probe.mjs");
        const module = pathToFileURL(join(ROOT, "src", "core", "ancestry.ts")).href;
        writeFileSync(
          probe,
          `const a = await import(${JSON.stringify(module)});\nprocess.stdout.write(String(a.claudeAncestor(a.nodeAncestors()) !== undefined));\n`,
        );
        const inner = `const r = require("node:child_process").spawnSync(process.execPath, ["--import", "tsx", ${JSON.stringify(probe)}], { cwd: ${JSON.stringify(ROOT)}, encoding: "utf8" }); process.stdout.write(r.stdout);`;
        const under = spawnSync(process.execPath, ["-e", inner], { argv0: "claude", cwd: ROOT, encoding: "utf8" });
        assert.equal(under.stdout, "true", under.stderr);
        const plain = spawnSync(process.execPath, ["-e", inner], { argv0: "node", cwd: ROOT, encoding: "utf8" });
        assert.equal(plain.stdout, String(claudeAncestor(nodeAncestors()) !== undefined), plain.stderr);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
