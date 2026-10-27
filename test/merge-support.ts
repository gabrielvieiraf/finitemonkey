import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

import type { AbsolutePath } from "../src/core/brand.js";
import { isRecord, type JsonObject } from "../src/core/parsed.js";
import { git, initRepo, tempDir, write } from "./git-support.js";
import { BUNDLE, field, parseBody } from "./support.js";

export interface Box {
  readonly root: AbsolutePath;
  readonly home: AbsolutePath;
  readonly dispose: () => void;
}

export const sandbox = (files: Readonly<Record<string, string>>): Box => {
  const root = tempDir("fm-merge-");
  const home = tempDir("fm-merge-home-");
  initRepo(root);
  for (const [path, content] of Object.entries(files)) write(root, path, content);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return {
    root,
    home,
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
};

export const commitOn = (box: Box, branch: string, files: Readonly<Record<string, string>>, from?: string): void => {
  git(box.root, "switch", "-q", ...(from === undefined ? [branch] : ["-c", branch, from]));
  for (const [path, content] of Object.entries(files)) write(box.root, path, content);
  git(box.root, "add", "-A");
  git(box.root, "commit", "-q", "-m", `feat: ${branch}`);
};

export const sides = (
  box: Box,
  ours: Readonly<Record<string, string>>,
  theirs: Readonly<Record<string, string>>,
): void => {
  commitOn(box, "feat/x", theirs, "main");
  commitOn(box, "main", ours);
};

export const merge = (box: Box, ...extra: readonly string[]): JsonObject => {
  const result = spawnSync(process.execPath, [BUNDLE, "merge", "feat/x", "--json", ...extra], {
    cwd: box.root,
    encoding: "utf8",
    env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], HOME: box.home, USERPROFILE: box.home },
    timeout: 120000,
  });
  const body = parseBody(result.stdout);
  const data = field(body, "data");
  assert.ok(isRecord(data), `${result.stdout}\n${result.stderr}`);
  return data;
};

export interface Hunk {
  readonly cls: string;
  readonly rule: string;
}

export const hunksOf = (report: JsonObject, path: string): readonly Hunk[] => {
  const files = report["files"];
  assert.ok(Array.isArray(files));
  const file: unknown = files.find((item: unknown) => field(item, "path") === path);
  assert.ok(file, `${path} in ${JSON.stringify(files)}`);
  const hunks = field(file, "hunks");
  assert.ok(Array.isArray(hunks));
  const rows = hunks.length === 0 ? [file] : hunks;
  return rows.map((item: unknown) => ({ cls: String(field(item, "class")), rule: String(field(item, "rule")) }));
};

export const resultFile = (box: Box, report: JsonObject, path: string): string =>
  git(box.root, "show", `${String(report["commit"])}:${path}`);

export const ROUTES = 'export const routes = [\n  "/home",\n];\n';
