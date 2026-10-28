import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import type { GitResult } from "../src/core/runtime.js";
import { DEFAULT_ITEMS, defaultsFromConfig, LEGACY_NEUTRAL_OFF, withoutLegacyPreset } from "../src/defaults/items.js";
import { commitMessageProblems } from "../src/githooks/commit-msg.js";
import { hashText } from "../src/install/hash.js";
import { CONFIG_FILE, LOCK_FILE, SETTINGS_FILE } from "../src/install/layout.js";
import { scoreFiles } from "../src/prose/gate.js";
import { at, repo, ROOT, run } from "./install-support.js";
import { type MemoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field, found, parseBody } from "./support.js";

const settingsOf = (fs: MemoryFs): unknown => parseBody(fs.read(at(SETTINGS_FILE)) ?? "{}");

describe("defaults: init writes the evidence-backed set", () => {
  it("writes no preset, turns attribution off and leaves every default on", async () => {
    const fs = repo();
    assert.equal((await run(fs, ["init", "--yes"])).code, 0);
    const config = fs.read(at(CONFIG_FILE)) ?? "";
    assert.doesNotMatch(config, /preset/);
    assert.deepEqual(defaultsFromConfig(config).off, []);
    assert.deepEqual(field(settingsOf(fs), "attribution"), { commit: "", pr: "", sessionUrl: false });
  });

  it("a default turned off in config.yml stays off on update", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes"]);
    const config = `${fs.read(at(CONFIG_FILE)) ?? ""}defaults:\n  branch-names: off\n`;
    fs.writeAtomic(toAbsolutePath(at(CONFIG_FILE)), config);
    await run(fs, ["update", "--yes"]);
    assert.deepEqual(defaultsFromConfig(fs.read(at(CONFIG_FILE)) ?? "").off, ["branch-names"]);
  });
});

const legacyInstall = async (preset: string): Promise<MemoryFs> => {
  const fs = repo();
  await run(fs, ["init", "--yes"], "0.1.0-next.39");
  const old = (fs.read(at(CONFIG_FILE)) ?? "").replace("schemaVersion: 1\n", `schemaVersion: 1\npreset: ${preset}\n`);
  fs.writeAtomic(toAbsolutePath(at(CONFIG_FILE)), old);
  const lock = parseBody(fs.read(at(LOCK_FILE)) ?? "{}");
  const entries = field(lock, "entries");
  const fixed = (Array.isArray(entries) ? entries : []).map((entry: unknown) =>
    field(entry, "path") === CONFIG_FILE && typeof entry === "object" && entry !== null
      ? { ...entry, hash: hashText(old) }
      : entry,
  );
  fs.writeAtomic(toAbsolutePath(at(LOCK_FILE)), JSON.stringify({ ...lock, preset, entries: fixed }, null, 2));
  return fs;
};

describe("defaults: old preset values migrate", () => {
  it("neutral becomes the defaults it had off, and the behavior stays", async () => {
    const fs = await legacyInstall("neutral");
    assert.deepEqual(defaultsFromConfig(fs.read(at(CONFIG_FILE)) ?? "").off, LEGACY_NEUTRAL_OFF);
    const updated = await run(fs, ["update", "--yes"], "0.1.0-next.40");
    assert.equal(updated.code, 0, updated.stdout);
    const config = fs.read(at(CONFIG_FILE)) ?? "";
    assert.doesNotMatch(config, /preset/);
    assert.deepEqual(defaultsFromConfig(config).off, LEGACY_NEUTRAL_OFF);
    assert.match(config, /defaults:\n {2}no-attribution: off\n/);
    assert.equal(parseBody(fs.read(at(LOCK_FILE)) ?? "{}")["preset"], undefined);
  });

  it("gabriel becomes the plain defaults", async () => {
    const fs = await legacyInstall("gabriel");
    await run(fs, ["update", "--yes"], "0.1.0-next.40");
    const config = fs.read(at(CONFIG_FILE)) ?? "";
    assert.doesNotMatch(config, /preset|defaults:/);
    assert.deepEqual(defaultsFromConfig(config).off, []);
  });

  it("the file migration rewrites the preset line of an edited config", () => {
    const edited = "# mine\nschemaVersion: 1\npreset: neutral\nlang: pt-BR\n";
    const migrated = withoutLegacyPreset(edited);
    assert.doesNotMatch(migrated, /preset/);
    assert.deepEqual(defaultsFromConfig(migrated).off, LEGACY_NEUTRAL_OFF);
    assert.equal(withoutLegacyPreset("schemaVersion: 1\npreset: gabriel\n"), "schemaVersion: 1\n");
  });
});

const FREE_LOG = Array.from({ length: 12 }, (_, index) => `update the page ${String(index)}`).join("\n");

const freeGit = (args: readonly string[]): GitResult =>
  args[0] === "log" ? { found: true, ok: true, stdout: `${FREE_LOG}\n` } : { found: false, ok: false, stdout: "" };

const tty = (answers: string): TextSource => Object.assign(Readable.from([answers]), { isTTY: true });

const init = (fs: MemoryFs, stdin: TextSource, extra: readonly string[] = []) =>
  cliJson(["init", "--yes", ...extra], {
    cwd: ROOT,
    runtime: fakeRuntime({ fs, git: freeGit, tools: { claude: found("2.1.300 (Claude Code)") } }),
    env: {},
    stdin,
  });

describe("defaults: a repository with another commit convention", () => {
  it("gets one question, then follows the answer", async () => {
    const fs = repo();
    const first = await init(fs, tty("n\n"));
    assert.equal(first.code, 0, first.stdout);
    assert.match(first.stderr, /Use Conventional Commits from now on/);
    const config = fs.read(at(CONFIG_FILE)) ?? "";
    assert.match(config, /conventions:\n {2}commits: free/);
    assert.ok(defaultsFromConfig(config).off.includes("conventional-commits"));
    const again = await init(fs, tty("y\n"));
    assert.doesNotMatch(again.stderr, /Use Conventional Commits/);
    assert.match(fs.read(at(CONFIG_FILE)) ?? "", /commits: free/);
    const check = await cliJson(["commit-msg", "msg.txt"], {
      cwd: ROOT,
      runtime: fakeRuntime({ fs: repo({ ...fsFiles(fs), "msg.txt": "update the readme\n" }) }),
    });
    assert.equal(check.code, 0, check.stdout);
  });

  it("without a person at the terminal it asks through the report and changes nothing", async () => {
    const fs = repo();
    const result = await init(fs, Readable.from([]));
    assert.match(result.stdout + result.stderr, /--commits free/);
    assert.doesNotMatch(fs.read(at(CONFIG_FILE)) ?? "", /conventions/);
  });

  it("the commit check follows the stored style", () => {
    assert.deepEqual(commitMessageProblems("update the readme\n", false), []);
    assert.deepEqual(commitMessageProblems("update the readme\n"), ["header"]);
  });
});

const fsFiles = (fs: MemoryFs): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(fs.files())
      .filter(([path]) => path.includes(".finitemonkey/config.yml"))
      .map(([, text]) => [CONFIG_FILE, text]),
  );

describe("defaults: no time estimates in plans and reports", () => {
  const PLAN = "# Plan\n\nThe checkout step takes about 3 days and the review roughly 2 hours.\n";
  const files = (config = ""): Readonly<Record<string, string>> => ({
    [at("docs/plan/MASTER.md")]: PLAN,
    [at("README.md")]: PLAN,
    ...(config === "" ? {} : { [at(CONFIG_FILE)]: config }),
  });
  const rules = (config = "") => {
    const scored = scoreFiles(fakeRuntime({ files: files(config) }), ROOT, ["docs/plan/MASTER.md", "README.md"]);
    assert.ok(scored.ok);
    return scored.value.map((item) => [item.file, item.report.hits.some((hit) => hit.rule === "time-estimate")]);
  };

  it("flags an estimate in a plan, not in the README", () => {
    assert.deepEqual(rules(), [
      ["docs/plan/MASTER.md", true],
      ["README.md", false],
    ]);
  });

  it("stays quiet when no-time-estimates is off", () => {
    assert.deepEqual(rules("defaults:\n  no-time-estimates: off\n"), [
      ["docs/plan/MASTER.md", false],
      ["README.md", false],
    ]);
  });
});

describe("defaults: every item names its evidence in the docs", () => {
  for (const file of ["README.md", "README.pt-BR.md", "README.es.md"]) {
    it(`${file} lists every default with its evidence`, () => {
      const text = readFileSync(join(ROOT_DIR, file), "utf8");
      const section = text.slice(text.indexOf("generated:defaults:start"), text.indexOf("generated:defaults:end"));
      for (const item of DEFAULT_ITEMS) {
        const row = section.split("\n").find((line) => line.startsWith(`| \`${item}\` |`));
        assert.ok(row !== undefined, `${file}: ${item}`);
        assert.equal(row.split(" | ").length, 3, row);
      }
    });
  }
});

const ROOT_DIR = join(import.meta.dirname, "..");
