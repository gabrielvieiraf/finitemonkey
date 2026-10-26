import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeExec } from "../src/core/node-exec.js";
import { quoteForCmd, resolveWindowsCommand, windowsCommandLine } from "../src/core/windows-command.js";
import { checkLineEndings } from "../src/doctor/line-endings.js";
import { locationOf } from "../src/install/plan.js";
import { git, tempRepo } from "./git-support.js";
import { at, repo, ROOT } from "./install-support.js";
import { memoryFs } from "./memory-fs.js";
import { BUNDLE, BUNDLE_TEXT, cliJson, fakeRuntime, field, found, gitMissing, ROOT as REPO_ROOT } from "./support.js";

describe("Windows commands resolve through PATHEXT", () => {
  const env = { Path: "C:\\nodejs;C:\\Program Files\\GitHub CLI", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  const files = new Set(["c:\\nodejs\\npm.cmd", "c:\\nodejs\\node.exe", "c:\\program files\\github cli\\gh.exe"]);
  const exists = (path: string): boolean => files.has(path.toLowerCase());

  it("runs npm through its .cmd shim with a shell, and gh.exe directly", () => {
    assert.deepEqual(resolveWindowsCommand("npm", env, exists), { command: "C:\\nodejs\\npm.cmd", shell: true });
    assert.deepEqual(resolveWindowsCommand("gh", env, exists), {
      command: "C:\\Program Files\\GitHub CLI\\gh.exe",
      shell: false,
    });
    assert.deepEqual(resolveWindowsCommand("claude", env, exists), { command: "claude", shell: false });
  });

  it("quotes the command line for cmd.exe", () => {
    assert.equal(quoteForCmd("--version"), "--version");
    assert.equal(quoteForCmd('a "b" c'), '"a ""b"" c"');
    assert.equal(
      windowsCommandLine({ command: "C:\\Program Files\\nodejs\\npm.cmd", shell: true }, ["view", "x y"]),
      '"C:\\Program Files\\nodejs\\npm.cmd" view "x y"',
    );
  });

  it("spawns npm on the real system", { skip: process.platform !== "win32" }, () => {
    const result = nodeExec({ command: "npm", args: ["--version"], cwd: toAbsolutePath(REPO_ROOT), timeoutMs: 60_000 });
    assert.equal(result.found, true, result.stderr);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
  });
});

describe("init warns about WSL drive mounts and synced folders", () => {
  it("detects a Windows drive under WSL and a synced folder", () => {
    assert.deepEqual(locationOf("/mnt/c/Users/ana/OneDrive/app", { WSL_DISTRO_NAME: "Ubuntu" }), {
      wslMount: true,
      synced: true,
    });
    assert.deepEqual(locationOf("/mnt/c/app", {}), { wslMount: false, synced: false });
    assert.deepEqual(locationOf("/home/ana/app", { WSL_DISTRO_NAME: "Ubuntu" }), { wslMount: false, synced: false });
  });

  const synced = { en: /synced folder/, "pt-BR": /pasta sincronizada/, es: /carpeta sincronizada/ } as const;
  const mounted = { en: /Windows drive/, "pt-BR": /disco do Windows/, es: /disco de Windows/ } as const;
  const posix = process.platform !== "win32";
  for (const lang of ["en", "pt-BR", "es"] as const) {
    it(`init --dry-run shows the warnings in ${lang}`, async () => {
      const root = toAbsolutePath("/mnt/c/Users/ana/OneDrive/app");
      const result = await cliJson(["init", "--dry-run", "--lang", lang], {
        cwd: root,
        runtime: fakeRuntime({
          fs: memoryFs({ [BUNDLE]: BUNDLE_TEXT }, [join(root, ".git")]),
          tools: { claude: found("2.1.300 (Claude Code)") },
        }),
        env: { WSL_DISTRO_NAME: "Ubuntu" },
      });
      const warnings = field(result.body, "data", "warnings");
      assert.ok(Array.isArray(warnings));
      const codes = warnings.map((warning: unknown) => field(warning, "code"));
      const text = JSON.stringify(warnings);
      assert.ok(codes.includes("synced_folder"), String(codes));
      assert.match(text, synced[lang]);
      if (posix) {
        assert.ok(codes.includes("wsl_mount"), String(codes));
        assert.match(text, mounted[lang]);
      }
    });
  }
});

describe("doctor suggests pinning LF when core.autocrlf would break hooks", () => {
  const check = (autocrlf: string | undefined, attributes?: string) =>
    checkLineEndings({
      platform: "win32",
      env: {},
      cwd: ROOT,
      root: ROOT,
      version: "1.0.0",
      runtime: fakeRuntime({
        files: attributes === undefined ? {} : { [at(".gitattributes")]: attributes },
        git: (args) =>
          args.join(" ") === "config --get core.autocrlf" && autocrlf !== undefined
            ? { found: true, ok: true, stdout: `${autocrlf}\n` }
            : gitMissing,
      }),
    });

  it("warns with autocrlf=true and no eol=lf rule, and stays quiet otherwise", () => {
    assert.deepEqual(
      check("true").map((item) => [item.check, item.status]),
      [["git.autocrlf", "warn"]],
    );
    assert.deepEqual(check("true", "* text=auto eol=lf\n"), []);
    assert.deepEqual(check("input"), []);
    assert.deepEqual(check(undefined), []);
  });
});

describe("hooks accept CRLF input", () => {
  it("a PreToolUse payload with CRLF line breaks is read and still blocks a force push", () => {
    const repoDir = tempRepo();
    try {
      git(repoDir.root, "switch", "-q", "-c", "feat/x");
      const payload = [
        "{",
        '  "hook_event_name": "PreToolUse",',
        '  "session_id": "s1",',
        '  "tool_name": "Bash",',
        '  "tool_input": { "command": "git push --force origin main\\r\\n" }',
        "}",
        "",
      ].join("\r\n");
      const run = spawnSync(process.execPath, [BUNDLE, "hook", "PreToolUse"], {
        cwd: repoDir.root,
        input: payload,
        encoding: "utf8",
        env: {
          PATH: process.env["PATH"],
          SystemRoot: process.env["SystemRoot"],
          HOME: repoDir.root,
          USERPROFILE: repoDir.root,
        },
      });
      assert.equal(run.status, 2, run.stdout + run.stderr);
      assert.match(run.stderr, /--force/);
    } finally {
      repoDir.dispose();
    }
  });
});

describe("no file name contains a colon", () => {
  it("in the repository, the npm package and the files init writes", async () => {
    const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.split("\0");
    const fs = repo();
    await cliJson(["init", "--yes"], {
      cwd: ROOT,
      runtime: fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } }),
      env: {},
    });
    const generated = Object.keys(fs.files()).map((path) => path.replace(/^[A-Za-z]:/, ""));
    const offenders = [...tracked, ...generated].filter((path) => path.includes(":"));
    assert.deepEqual(offenders, []);
    assert.ok(tracked.includes(join("src", "cli.ts").replace(/\\/g, "/")));
  });
});
