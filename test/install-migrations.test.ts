import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { compareSemver, parseSemver } from "../src/core/semver.js";
import { ExitCode } from "../src/exit-codes.js";
import { createTranslator } from "../src/i18n/translate.js";
import { applyPlan } from "../src/install/apply.js";
import { CONFIG_FILE, SETTINGS_FILE } from "../src/install/layout.js";
import { pendingMigrations } from "../src/install/migrate.js";
import type { Migration } from "../src/install/migrations/index.js";
import { buildPlan, detect, type PlanInput, readPreviousLock } from "../src/install/plan.js";
import { projectAt } from "../src/install/project.js";
import { at, FAKE_BUNDLE, repo, ROOT, run } from "./install-support.js";
import { fakeRuntime, field, found } from "./support.js";

const semver = (raw: string) => {
  const parsed = parseSemver(raw);
  assert.ok(parsed, raw);
  return parsed;
};

describe("versions compare by semver, not as text", () => {
  const ordered = ["0.9.0", "0.10.0", "1.0.0-next.2", "1.0.0-next.10", "1.0.0-rc.1", "1.0.0", "1.0.1", "10.0.0"];
  it("sorts a mixed list the way semver does", () => {
    const shuffled = [...ordered].reverse();
    assert.deepEqual(
      shuffled.sort((a, b) => compareSemver(semver(a), semver(b))),
      ordered,
    );
  });

  it("rejects what is not a version", () => {
    assert.equal(parseSemver("1.0"), undefined);
    assert.equal(parseSemver("latest"), undefined);
  });

  it("picks the migrations above the installed version up to the running one, in order", () => {
    const migration = (version: string): Migration => ({ version, files: [] });
    const all = [migration("0.10.0"), migration("0.2.0"), migration("0.9.0"), migration("0.11.0")];
    assert.deepEqual(
      pendingMigrations(all, "0.2.0", "0.10.0").map((item) => item.version),
      ["0.9.0", "0.10.0"],
    );
  });
});

describe("update applies per-version migrations with backup", () => {
  const MIGRATION: Migration = {
    version: "1.1.0",
    files: [{ path: CONFIG_FILE, migrate: (text) => text.replace("schemaVersion: 1", "schemaVersion: 2") }],
  };

  const update = (fs: ReturnType<typeof repo>) => {
    const runtime = fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } });
    const project = projectAt(ROOT, runtime);
    const previous = readPreviousLock(project);
    assert.ok(previous.ok && previous.value !== undefined);
    const input: PlanInput = {
      preset: "neutral",
      lang: "en",
      claudeLanguage: undefined,
      bin: undefined,
      version: "1.1.0",
      marketplace: false,
      sandbox: false,
      offerSandbox: false,
      platform: "linux",
      bundle: FAKE_BUNDLE,
      env: {},
      t: createTranslator("en"),
    };
    const plan = buildPlan(project, detect(project, true, input), input, previous.value, [MIGRATION]);
    assert.ok(plan.ok);
    return { project, plan: plan.value };
  };

  it("migrates an untouched file, and uninstall then leaves the tree as it was before install", async () => {
    const fs = repo({ ".gitignore": "node_modules\n" });
    const before = fs.files();
    assert.equal((await run(fs, ["init", "--yes"], "1.0.0")).code, ExitCode.Ok);
    const { project, plan } = update(fs);
    assert.equal(plan.items.find((item) => item.path === CONFIG_FILE)?.action, "update");
    assert.ok(applyPlan(project, plan, "1.1.0").ok);
    assert.match(fs.read(at(CONFIG_FILE)) ?? "", /schemaVersion: 2/);
    assert.equal((await run(fs, ["uninstall", "--yes", "--purge"], "1.1.0")).code, ExitCode.Ok);
    assert.deepEqual(fs.files(), before);
  });

  it("over a file the person edited, proposes the migrated text and never overwrites", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes"], "1.0.0");
    const edited = `${fs.read(at(CONFIG_FILE)) ?? ""}custom: true\n`;
    fs.writeAtomic(toAbsolutePath(at(CONFIG_FILE)), edited);
    const { project, plan } = update(fs);
    const item = plan.items.find((entry) => entry.path === CONFIG_FILE);
    assert.equal(item?.action, "keep-edited");
    assert.match(item.proposal ?? "", /schemaVersion: 2/);
    assert.ok(applyPlan(project, plan, "1.1.0").ok);
    assert.equal(fs.read(at(CONFIG_FILE)), edited);
  });

  it("a permission error during update returns a code and a fix", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes"], "1.0.0");
    fs.failWritesTo(at(SETTINGS_FILE), "EACCES");
    const result = await run(fs, ["update", "--yes", "--preset", "gabriel"], "1.1.0");
    assert.equal(field(result.body, "error", "code"), "install_permission_denied");
    assert.match(String(field(result.body, "error", "fix")), /write access to \.claude\/settings\.json/);
  });
});
