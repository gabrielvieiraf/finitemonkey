import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { ExitCode } from "../src/exit-codes.js";
import { lineDiff } from "../src/install/diff.js";
import {
  CONFIG_FILE,
  LOCK_FILE,
  SETTINGS_FILE,
  VENDOR_BIN,
  VENDOR_PACKAGE,
  VERIFY_SKILL,
} from "../src/install/layout.js";
import { actions, at, FAKE_BUNDLE, repo, ROOT, run } from "./install-support.js";
import { memoryFs } from "./memory-fs.js";
import { BUNDLE, cli, cliJson, fakeRuntime, field, parseBody, stdinFrom } from "./support.js";

const settingsOf = (fs: ReturnType<typeof memoryFs>): unknown => parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}");

describe("init detection matrix", () => {
  const cases = [
    { name: "empty repo", files: {}, pm: null, languages: [], runner: "vendored" },
    {
      name: "pnpm typescript",
      files: { "package.json": "{}", "pnpm-lock.yaml": "", "tsconfig.json": "{}" },
      pm: "pnpm",
      languages: ["typescript", "javascript"],
      runner: "vendored",
    },
    {
      name: "packageManager field wins",
      files: { "package.json": '{"packageManager":"yarn@4.1.0"}', "package-lock.json": "{}" },
      pm: "yarn",
      languages: ["javascript"],
      runner: "vendored",
    },
    {
      name: "bun and local bin",
      files: { "package.json": "{}", "bun.lock": "", "node_modules/finitemonkey/dist/finitemonkey.mjs": "" },
      pm: "bun",
      languages: ["javascript"],
      runner: "local",
    },
    {
      name: "python and go",
      files: { "pyproject.toml": "", "go.mod": "" },
      pm: null,
      languages: ["python", "go"],
      runner: "vendored",
    },
  ] as const;
  for (const { name, files, pm, languages, runner } of cases) {
    it(name, async () => {
      const { body } = await run(repo(files), ["init", "--dry-run"]);
      assert.equal(field(body, "data", "detection", "packageManager"), pm);
      assert.deepEqual(field(body, "data", "detection", "languages"), languages);
      assert.equal(field(body, "data", "detection", "runner"), runner);
      assert.equal(field(body, "data", "detection", "gitRoot"), true);
    });
  }

  it("finds the git root from a subfolder and reports other stop authorities", async () => {
    const fs = repo({
      [SETTINGS_FILE]: JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "ralph" }] }] },
        enabledPlugins: { "oh-my-claudecode@x": true, "finitemonkey@finitemonkey": true },
      }),
    });
    fs.mkdir(toAbsolutePath(at(".planning")));
    const { body } = await cliJson(["init", "--dry-run"], {
      cwd: toAbsolutePath(at("src/deep")),
      runtime: fakeRuntime({ fs }),
      env: {},
    });
    assert.equal(field(body, "data", "root"), ROOT);
    const kinds = field(body, "data", "detection", "authorities");
    assert.deepEqual(Array.isArray(kinds) ? kinds.map((item) => field(item, "kind")).sort() : [], [
      "finitemonkey-plugin",
      "loop-plugin",
      "stop-hook",
      "workflow",
    ]);
  });

  it("outside git it installs at the current folder and warns", async () => {
    const { body } = await cliJson(["init", "--dry-run"], {
      cwd: ROOT,
      runtime: fakeRuntime({ fs: memoryFs({ [BUNDLE]: FAKE_BUNDLE }) }),
      env: {},
    });
    assert.equal(field(body, "data", "detection", "gitRoot"), false);
    const warnings = field(body, "data", "warnings");
    assert.ok(Array.isArray(warnings) && warnings.some((item) => field(item, "code") === "not_git"));
  });
});

describe("init writes only when asked", () => {
  it("--dry-run writes nothing and exits 0", async () => {
    const fs = repo({ ".gitignore": "dist\n" });
    const result = await run(fs, ["init", "--dry-run"]);
    assert.equal(result.code, ExitCode.Ok);
    assert.equal(fs.writes(), 0);
    assert.deepEqual(actions(result.body), {
      [SETTINGS_FILE]: "create",
      ".gitignore": "merge",
      "AGENTS.md": "create",
      "CLAUDE.md": "create",
      [CONFIG_FILE]: "create",
      [VERIFY_SKILL]: "create",
      ".finitemonkey/policy.yml": "create",
      [VENDOR_BIN]: "create",
      [VENDOR_PACKAGE]: "create",
    });
  });

  it("without --yes it shows the plan, writes nothing and exits 4 with next", async () => {
    const fs = repo();
    const result = await run(fs, ["init", "--preset", "gabriel"]);
    assert.equal(result.code, ExitCode.NeedsPerson);
    assert.equal(field(result.body, "error", "code"), "needs_confirmation");
    assert.equal(field(result.body, "next"), "finitemonkey init --yes --preset gabriel");
    assert.equal(fs.writes(), 0);
  });

  it("an unknown preset is a usage error", async () => {
    const result = await run(repo(), ["init", "--preset", "loud", "--yes"]);
    assert.equal(result.code, ExitCode.Usage);
  });

  it("broken settings JSON is never overwritten", async () => {
    const fs = repo({ [SETTINGS_FILE]: "{ nope" });
    const result = await run(fs, ["init", "--yes"]);
    assert.equal(result.code, ExitCode.NotConfigured);
    assert.equal(field(result.body, "error", "code"), "settings_unreadable");
    assert.equal(fs.writes(), 0);
  });
});

describe("init is idempotent and merges without clobbering", () => {
  it("a second run writes nothing", async () => {
    const fs = repo({ ".gitignore": "node_modules" });
    assert.equal((await run(fs, ["init", "--yes"])).code, ExitCode.Ok);
    const writes = fs.writes();
    const again = await run(fs, ["init", "--yes"]);
    assert.equal(again.code, ExitCode.Ok);
    assert.equal(fs.writes(), writes);
    assert.ok(Object.values(actions(again.body)).every((action) => action === "unchanged"));
  });

  it("keeps user hooks, permissions and attribution and adds the deny floor once", async () => {
    const user = {
      attribution: { commit: "made by me" },
      permissions: { allow: ["Bash(ls)"], deny: ["Read(./.env)"] },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-guard" }] }] },
    };
    const fs = repo({ [SETTINGS_FILE]: JSON.stringify(user, null, 2) });
    await run(fs, ["init", "--yes", "--preset", "gabriel"]);
    const settings = settingsOf(fs);
    assert.deepEqual(field(settings, "attribution"), { commit: "made by me" });
    assert.deepEqual(field(settings, "permissions", "allow"), ["Bash(ls)"]);
    const deny = field(settings, "permissions", "deny");
    assert.ok(Array.isArray(deny) && deny.filter((rule) => rule === "Read(./.env)").length === 1);
    assert.ok(Array.isArray(deny) && deny.includes("Bash(git push --force *)"));
    const pre = field(settings, "hooks", "PreToolUse");
    assert.ok(Array.isArray(pre) && pre.length === 2);
    assert.equal(JSON.stringify(pre[0]), JSON.stringify(user.hooks.PreToolUse[0]));
    const ours = field(pre[1], "hooks");
    assert.equal(field(Array.isArray(ours) ? ours[0] : undefined, "onFailure"), "block");
  });

  it("the neutral preset never touches attribution and gabriel only fills it when absent", async () => {
    const neutral = repo();
    await run(neutral, ["init", "--yes"]);
    assert.equal(field(settingsOf(neutral), "attribution"), undefined);
    const gabriel = repo();
    await run(gabriel, ["init", "--yes", "--preset", "gabriel"]);
    assert.deepEqual(field(settingsOf(gabriel), "attribution"), { commit: "", pr: "", sessionUrl: false });
  });

  it("a failed write puts every file back and says which one failed", async () => {
    const fs = repo({ [SETTINGS_FILE]: "{}\n", ".gitignore": "x\n" });
    fs.failWritesTo(at(CONFIG_FILE));
    const result = await run(fs, ["init", "--yes"]);
    assert.equal(result.code, ExitCode.NotConfigured);
    assert.equal(field(result.body, "error", "code"), "install_failed");
    assert.equal(fs.read(at(SETTINGS_FILE)), "{}\n");
    assert.equal(fs.read(at(".gitignore")), "x\n");
    assert.equal(fs.read(at(LOCK_FILE)), undefined);
  });

  it("a held install lock stops a concurrent run, and a stale one is taken over", async () => {
    const fs = repo();
    const held = fs.lock(toAbsolutePath(at(".finitemonkey/locks/install.lock")), { staleMs: 1000, owner: "other" });
    assert.ok(held.ok);
    const blocked = await run(fs, ["init", "--yes"]);
    assert.equal(field(blocked.body, "error", "code"), "install_locked");
    fs.tick(10 * 60 * 1000);
    assert.equal((await run(fs, ["init", "--yes"])).code, ExitCode.Ok);
  });
});

describe("marketplace registration and the plugin stepping aside", () => {
  it("--marketplace registers the repository marketplace once and uninstall takes it back", async () => {
    const fs = repo({ [SETTINGS_FILE]: '{"enabledPlugins":{"other@x":true}}\n' });
    await run(fs, ["init", "--yes", "--marketplace"]);
    const settings = settingsOf(fs);
    assert.deepEqual(field(settings, "extraKnownMarketplaces", "finitemonkey"), {
      source: { source: "github", repo: "gabrielvieiraf/finitemonkey" },
    });
    assert.equal(field(settings, "enabledPlugins", "finitemonkey@finitemonkey"), true);
    const raw = fs.read(at(SETTINGS_FILE)) ?? "";
    fs.writeAtomic(toAbsolutePath(at(SETTINGS_FILE)), raw.replace('"other@x": true', '"other@x": false'));
    await run(fs, ["uninstall", "--yes"]);
    assert.deepEqual(settingsOf(fs), { enabledPlugins: { "other@x": false } });
  });

  it("without --marketplace nothing about plugins is written", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes"]);
    assert.equal(field(settingsOf(fs), "extraKnownMarketplaces"), undefined);
    assert.equal(field(settingsOf(fs), "enabledPlugins"), undefined);
  });

  const plugin = (fs: ReturnType<typeof memoryFs>) =>
    cli(["hook", "Stop", "--via", "plugin"], {
      cwd: ROOT,
      runtime: fakeRuntime({ fs }),
      env: { CLAUDE_PROJECT_DIR: ROOT },
      stdin: stdinFrom("not json"),
    });

  it("plugin hooks answer continue without reading stdin when the project has its own hooks", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes"]);
    const result = await plugin(fs);
    assert.equal(result.code, ExitCode.Ok);
    assert.equal(result.stdout, '{"continue":true}\n');
  });

  it("plugin hooks run normally when the project has none", async () => {
    const result = await plugin(repo());
    assert.equal(result.code, 2);
    assert.match(result.stderr, /could not run/);
  });
});

describe("a teammate who clones an installed repository", () => {
  it("adopts the committed config and settings instead of calling them foreign", async () => {
    const first = repo();
    await run(first, ["init", "--yes"]);
    const committed = Object.fromEntries(
      [
        SETTINGS_FILE,
        ".gitignore",
        "AGENTS.md",
        "CLAUDE.md",
        CONFIG_FILE,
        ".finitemonkey/policy.yml",
        VERIFY_SKILL,
        VENDOR_BIN,
        VENDOR_PACKAGE,
      ].map((path) => [path, first.read(at(path)) ?? ""]),
    );
    const clone = repo(committed);
    const result = await run(clone, ["init", "--yes"]);
    assert.equal(result.code, ExitCode.Ok);
    assert.ok(Object.values(actions(result.body)).every((action) => action === "unchanged"));
    assert.ok(clone.read(at(LOCK_FILE)) !== undefined);
    const edited = repo({ ...committed, [CONFIG_FILE]: `${committed[CONFIG_FILE] ?? ""}custom: 1\n` });
    const kept = await run(edited, ["init", "--yes"]);
    assert.equal(actions(kept.body)[CONFIG_FILE], "keep-edited");
    await run(edited, ["update", "--yes"], "2.0.0");
    assert.match(edited.read(at(CONFIG_FILE)) ?? "", /custom: 1/);
  });
});

describe("Windows-style paths in the fake file system", () => {
  const windows = (path: string): string => path.replace(/\//g, "\\");

  it("plan, apply and uninstall treat backslash and slash paths as the same file", async () => {
    const original = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"mine"}]}]}}\n';
    const fs = memoryFs(
      { [BUNDLE]: FAKE_BUNDLE, [windows(at(SETTINGS_FILE))]: original, [windows(at(".gitignore"))]: "x\r\n" },
      [windows(at(".git"))],
    );
    const installed = await run(fs, ["init", "--yes"]);
    assert.equal(installed.code, ExitCode.Ok);
    assert.equal(actions(installed.body)[SETTINGS_FILE], "merge");
    assert.match(fs.read(windows(at(SETTINGS_FILE))) ?? "", /"command": "mine"/);
    assert.match(fs.read(windows(at(SETTINGS_FILE))) ?? "", /finitemonkey\.mjs/);
    assert.ok(fs.read(windows(at(LOCK_FILE))) !== undefined);
    assert.equal(Object.keys(fs.files()).filter((path) => path.includes("\\")).length, 0);
    assert.equal((await run(fs, ["uninstall", "--yes", "--purge"])).code, ExitCode.Ok);
    assert.equal(fs.read(at(SETTINGS_FILE)), original);
    assert.equal(fs.read(windows(at(".gitignore"))), "x\r\n");
    assert.equal(fs.read(at(CONFIG_FILE)), undefined);
  });
});

describe("line diff of a large vendored file", () => {
  const big = Array.from({ length: 40_000 }, (_, index) => `const line${String(index)} = ${String(index)};`);

  it("is empty for identical text and only shows the changed middle otherwise", () => {
    const text = big.join("\n");
    assert.deepEqual(lineDiff("dist/x.mjs", text, text), []);
    const changed = [...big.slice(0, 20_000), "const added = true;", ...big.slice(20_000)].join("\n");
    assert.deepEqual(lineDiff("dist/x.mjs", text, changed), [
      "--- dist/x.mjs",
      "+++ dist/x.mjs",
      "+ const added = true;",
    ]);
  });
});
