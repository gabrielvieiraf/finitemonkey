import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { parseJsonObject } from "../src/core/parsed.js";
import { toPosixPath } from "../src/core/posix-path.js";
import { DEFAULT_HANDLERS, GUARD_SETS } from "../src/hooks/handlers.js";
import { runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import { instructionFindings } from "../src/instructions/findings.js";
import { readLoadRecords } from "../src/instructions/log.js";
import { loadDiff } from "../src/instructions/report.js";
import { MAX_IMPORT_HOPS, resolveInstructions } from "../src/instructions/resolve.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field, ROOT, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const HOME = "/home/test";

const at = (path: string): AbsolutePath => toAbsolutePath(path);
const abs = (path: string): string => toPosixPath(at(path));

const LONG = Array.from(
  { length: 205 },
  (_, index) => `- Rule number ${String(index)} keeps the build green and tidy`,
).join("\n");

const TREE: Readonly<Record<string, string>> = {
  "/etc/claude-code/CLAUDE.md": "# Company\n- Never paste customer data into a prompt or a file\n",
  "/home/test/.claude/CLAUDE.md": "# Me\n- Answer in short sentences with the command first\n",
  "/home/test/.claude/rules/publish.md": "- Never run npm publish from a local machine without review\n",
  "/home/ana/CLAUDE.md": "# Above the project\n- Keep secrets out of every repository in this folder\n",
  "/home/ana/project/.git/HEAD": "ref: refs/heads/main\n",
  "/home/ana/project/.finitemonkey/config.yml": "lang: en\n",
  "/home/ana/project/CLAUDE.md":
    "# Project\n@docs/conventions.md\n- Run npm publish from the local machine after review\n",
  "/home/ana/project/docs/conventions.md": "- Commit messages follow Conventional Commits in English\n",
  "/home/ana/project/CLAUDE.local.md": "- My local database runs on port 5433 for this checkout\n",
  "/home/ana/project/AGENTS.md": "# Agents\n- Agents open one pull request per issue with tests\n",
  "/home/ana/project/.claude/rules/general.md": "- Prefer small files with one responsibility each\n",
  "/home/ana/project/.claude/rules/api.md":
    "---\npaths:\n  - src/api/**\n---\n- Every API handler validates its input with the shared schema\n",
  "/home/ana/project/packages/web/CLAUDE.md": `${LONG}\n`,
  "/home/ana/project/node_modules/lib/CLAUDE.md": "- ignored because it is inside node_modules here\n",
};

const treeFs = (extra: Readonly<Record<string, string>> = {}): MemoryFs =>
  memoryFs(Object.fromEntries(Object.entries({ ...TREE, ...extra }).map(([path, text]) => [at(path), text])));

const resolve = (fs: MemoryFs, cwd: AbsolutePath = PROJECT) =>
  resolveInstructions({ runtime: fakeRuntime({ fs }), root: PROJECT, cwd, home: HOME, platform: "linux" });

const byDisplay = (fs: MemoryFs) => new Map(resolve(fs).files.map((file) => [file.display, file]));

describe("instructions: every layer resolves in Claude Code's order", () => {
  it("lists managed, user, ancestors, local, rules, imports and nested files", () => {
    const files = resolve(treeFs()).files;
    assert.deepEqual(
      files.map((file) => [file.display, file.layer, file.reason]),
      [
        [abs("/etc/claude-code/CLAUDE.md"), "managed", "session_start"],
        ["~/.claude/CLAUDE.md", "user", "session_start"],
        ["~/.claude/rules/publish.md", "user", "session_start"],
        [abs("/home/ana/CLAUDE.md"), "project", "session_start"],
        ["CLAUDE.md", "project", "session_start"],
        ["docs/conventions.md", "import", "include"],
        ["CLAUDE.local.md", "local", "session_start"],
        [".claude/rules/api.md", "rules", "path_glob_match"],
        [".claude/rules/general.md", "rules", "session_start"],
        ["packages/web/CLAUDE.md", "nested", "nested_traversal"],
      ],
    );
  });

  it("marks what survives compaction and counts lines and tokens", () => {
    const files = byDisplay(treeFs());
    assert.equal(files.get("CLAUDE.md")?.survivesCompaction, true);
    assert.equal(files.get("docs/conventions.md")?.survivesCompaction, true);
    assert.equal(files.get(".claude/rules/api.md")?.survivesCompaction, false);
    assert.deepEqual(files.get(".claude/rules/api.md")?.globs, ["src/api/**"]);
    assert.equal(files.get("packages/web/CLAUDE.md")?.survivesCompaction, false);
    assert.equal(files.get("packages/web/CLAUDE.md")?.lines, 205);
    assert.ok((files.get("CLAUDE.md")?.tokens ?? 0) > 10);
  });

  it("an AGENTS.md is shadowed by a CLAUDE.md on the path, unless imported or listed in instructionFiles", () => {
    assert.deepEqual(
      resolve(treeFs()).shadowed.map((file) => [file.display, file.by]),
      [["AGENTS.md", abs("/home/ana/CLAUDE.md")]],
    );
    const imported = resolve(treeFs({ "/home/ana/project/CLAUDE.md": "@AGENTS.md\n" }));
    assert.deepEqual(imported.shadowed, []);
    assert.ok(imported.files.some((file) => file.display === "AGENTS.md" && file.layer === "import"));
    const listed = resolve(
      treeFs({ "/home/ana/project/.claude/settings.json": JSON.stringify({ instructionFiles: ["AGENTS.md"] }) }),
    );
    assert.deepEqual(listed.shadowed, []);
    assert.ok(listed.files.some((file) => file.display === "AGENTS.md" && file.layer === "project"));
  });

  it("loads AGENTS.md when no CLAUDE.md exists on the path", () => {
    const fs = memoryFs({
      [at("/home/ana/project/.git/HEAD")]: "ref: refs/heads/main\n",
      [at("/home/ana/project/AGENTS.md")]: "- Agents open one pull request per issue with tests\n",
    });
    assert.deepEqual(
      resolve(fs).files.map((file) => [file.display, file.layer]),
      [["AGENTS.md", "agents"]],
    );
  });

  it(`follows imports up to ${String(MAX_IMPORT_HOPS)} hops and ignores imports inside code`, () => {
    const chain = Object.fromEntries(
      ["a", "b", "c", "d", "e", "f"].map((name, index, names) => [
        `/home/ana/project/docs/${name}.md`,
        index + 1 < names.length ? `@./${names[index + 1] ?? ""}.md\n` : "end\n",
      ]),
    );
    const fs = treeFs({
      ...chain,
      "/home/ana/project/CLAUDE.md": "@docs/a.md\n```\n@docs/f.md\n```\nUse `@docs/e.md` as text\n",
    });
    const imported = resolve(fs).files.filter((file) => file.layer === "import");
    assert.deepEqual(
      imported.map((file) => file.display),
      ["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md"],
    );
  });

  it("drops files matched by claudeMdExcludes", () => {
    const settings = JSON.stringify({ claudeMdExcludes: [abs("/home/ana/CLAUDE.md"), "**/packages/**"] });
    const fs = treeFs({ "/home/ana/project/.claude/settings.local.json": settings });
    const displays = resolve(fs).files.map((file) => file.display);
    assert.ok(!displays.includes(abs("/home/ana/CLAUDE.md")));
    assert.ok(!displays.includes("packages/web/CLAUDE.md"));
  });
});

describe("instructions: findings", () => {
  const findings = instructionFindings(resolve(treeFs()));

  it("finds a contradiction between the user and the project layer", () => {
    const pairs = findings.flatMap((item) => (item.kind === "conflict" ? [[item.first.file, item.second.file]] : []));
    assert.deepEqual(pairs, [["~/.claude/rules/publish.md", "CLAUDE.md"]]);
  });

  it("flags rules that only live in path-scoped or nested files, oversized files and a shadowed AGENTS.md", () => {
    const volatile = findings.flatMap((item) => (item.kind === "volatile" ? [item.at.file] : []));
    assert.ok(volatile.includes(".claude/rules/api.md"));
    assert.ok(volatile.includes("packages/web/CLAUDE.md"));
    assert.ok(findings.some((item) => item.kind === "oversized" && item.file === "packages/web/CLAUDE.md"));
    assert.ok(findings.some((item) => item.kind === "shadowed" && item.file === "AGENTS.md"));
  });

  it("finds the same rule stated in two layers", () => {
    const fs = treeFs({
      "/home/test/.claude/CLAUDE.md": "- Prefer small files with one single responsibility each\n",
    });
    const found = instructionFindings(resolve(fs));
    assert.ok(found.some((item) => item.kind === "duplicate"));
  });
});

const fire = async (fs: MemoryFs, payload: Readonly<Record<string, unknown>>) => {
  const runtime = fakeRuntime({ fs });
  return runHook("InstructionsLoaded", {
    stdin: stdinFrom(JSON.stringify({ cwd: PROJECT, ...payload })),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: PROJECT,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const recorded = (): readonly Readonly<Record<string, unknown>>[] =>
  readFileSync(join(ROOT, "test", "fixtures", "instructions", "session.jsonl"), "utf8")
    .split("\n")
    .flatMap((line) => {
      const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
      return parsed?.ok === true ? [parsed.value] : [];
    });

describe("instructions: what the session really loaded", () => {
  it("the InstructionsLoaded hook only appends one line per file", async () => {
    const fs = treeFs();
    const outcome = await fire(fs, { session_id: "s1", file_path: "CLAUDE.md", load_reason: "session_start" });
    assert.equal(outcome.verdict, "allow");
    assert.doesNotMatch(outcome.stdout, /additionalContext|systemMessage/);
    const records = readLoadRecords(fakeRuntime({ fs }), at("/home/ana/project/.finitemonkey"));
    assert.deepEqual(
      records.map((record) => [record.session, record.file, record.reason]),
      [["s1", abs("/home/ana/project/CLAUDE.md"), "session_start"]],
    );
  });

  it("the resolved list matches a recorded session", async () => {
    const fs = treeFs();
    for (const payload of recorded()) await fire(fs, payload);
    const records = readLoadRecords(fakeRuntime({ fs }), at("/home/ana/project/.finitemonkey"));
    const diff = loadDiff(resolve(fs), records, "linux");
    assert.equal(diff.session, "rec-1");
    assert.equal(diff.recorded, 10);
    assert.deepEqual(diff.missing, []);
    assert.deepEqual(diff.unexpected, []);
  });

  it("reports a file the session loaded that the resolver missed", async () => {
    const fs = treeFs();
    await fire(fs, { session_id: "s2", file_path: "/opt/other/CLAUDE.md", load_reason: "session_start" });
    const records = readLoadRecords(fakeRuntime({ fs }), at("/home/ana/project/.finitemonkey"));
    const diff = loadDiff(resolve(fs), records, "linux");
    assert.deepEqual(diff.unexpected, [abs("/opt/other/CLAUDE.md")]);
    assert.ok(diff.missing.includes("CLAUDE.md"));
  });

  it("adds nothing to SessionStart: the recorder only listens to InstructionsLoaded", () => {
    const set = GUARD_SETS.find((item) => item.id === "instructions");
    assert.deepEqual(Object.keys(set?.handlers ?? {}), ["InstructionsLoaded"]);
  });

  it("is off when policy.yml turns it off", async () => {
    const fs = treeFs({ "/home/ana/project/.finitemonkey/policy.yml": "guards:\n  instructions: off\n" });
    await fire(fs, { session_id: "s1", file_path: "CLAUDE.md", load_reason: "session_start" });
    assert.equal(fs.read(at("/home/ana/project/.finitemonkey/instructions.jsonl")), undefined);
  });
});

describe("instructions command", () => {
  it("prints files, diff, findings and the measure as JSON", async () => {
    const fs = treeFs();
    for (const payload of recorded()) await fire(fs, payload);
    const { code, body } = await cliJson(["instructions"], { runtime: fakeRuntime({ fs }), cwd: PROJECT });
    assert.equal(code, 0);
    assert.equal(field(body, "data", "schema"), "finitemonkey/instructions@1");
    const files = field(body, "data", "files");
    assert.ok(Array.isArray(files) && files.length === 10);
    assert.equal(field(body, "data", "measure", "sessions"), 1);
    assert.equal(field(body, "data", "measure", "withConflict"), 1);
    assert.equal(field(body, "data", "measure", "withVolatile"), 1);
  });
});
