import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { ExitCode } from "../src/exit-codes.js";
import { CONFIG_FILE, LOCK_FILE, SETTINGS_FILE } from "../src/install/layout.js";
import { memoryFs } from "./memory-fs.js";
import { cli, cliJson, fakeRuntime, field, found, parseBody, stdinFrom } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const at = (relative: string): string => join(ROOT, relative);

const repo = (files: Readonly<Record<string, string>> = {}): ReturnType<typeof memoryFs> =>
  memoryFs(Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])), [at(".git")]);

const run = (fs: ReturnType<typeof memoryFs>, argv: readonly string[], version?: string) =>
  cliJson(argv, {
    cwd: ROOT,
    runtime: fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } }),
    env: {},
    ...(version === undefined ? {} : { version }),
  });

const actions = (body: unknown): Readonly<Record<string, unknown>> => {
  const list = field(body, "data", "actions");
  const items: readonly unknown[] = Array.isArray(list) ? list : [];
  return Object.fromEntries(items.map((item) => [String(field(item, "path")), field(item, "action")]));
};

const settingsOf = (fs: ReturnType<typeof memoryFs>): unknown => parseBody(fs.files()[at(SETTINGS_FILE)] ?? "{}");

describe("init detection matrix", () => {
  const cases = [
    { name: "empty repo", files: {}, pm: null, languages: [], runner: "npx" },
    {
      name: "pnpm typescript",
      files: { "package.json": "{}", "pnpm-lock.yaml": "", "tsconfig.json": "{}" },
      pm: "pnpm",
      languages: ["typescript", "javascript"],
      runner: "npx",
    },
    {
      name: "packageManager field wins",
      files: { "package.json": '{"packageManager":"yarn@4.1.0"}', "package-lock.json": "{}" },
      pm: "yarn",
      languages: ["javascript"],
      runner: "npx",
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
      runner: "npx",
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
      runtime: fakeRuntime({ fs: memoryFs() }),
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
      [CONFIG_FILE]: "create",
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
    assert.equal(fs.files()[at(SETTINGS_FILE)], "{}\n");
    assert.equal(fs.files()[at(".gitignore")], "x\n");
    assert.equal(fs.files()[at(LOCK_FILE)], undefined);
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
    const raw = fs.files()[at(SETTINGS_FILE)] ?? "";
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
      [SETTINGS_FILE, ".gitignore", CONFIG_FILE].map((path) => [path, first.files()[at(path)] ?? ""]),
    );
    const clone = repo(committed);
    const result = await run(clone, ["init", "--yes"]);
    assert.equal(result.code, ExitCode.Ok);
    assert.ok(Object.values(actions(result.body)).every((action) => action === "unchanged"));
    assert.ok(clone.files()[at(LOCK_FILE)] !== undefined);
    const edited = repo({ ...committed, [CONFIG_FILE]: `${committed[CONFIG_FILE] ?? ""}custom: 1\n` });
    const kept = await run(edited, ["init", "--yes"]);
    assert.equal(actions(kept.body)[CONFIG_FILE], "keep-edited");
    await run(edited, ["update", "--yes"], "2.0.0");
    assert.match(edited.files()[at(CONFIG_FILE)] ?? "", /custom: 1/);
  });
});
