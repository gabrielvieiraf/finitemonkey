import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import { readLedger } from "../evidence/ledger.js";
import { parseShell } from "../guards/shell.js";
import { configDigest } from "../guards/tests/analyze.js";
import { isProtectedConfig, isTestFile } from "../guards/tests/patterns.js";
import { addedLines, fileAt } from "./git.js";
import type { GateContext } from "./types.js";

export const TEST_PIN_FEATURE = "test-pin";

const TEST_COMMAND =
  /\b(?:test|tests|vitest|jest|pytest|mocha|ava|tap|phpunit|rspec|unittest|nose2|go\s+test|cargo\s+test|node\s+--test)\b/;
const MASKED_EXIT = /\|\|\s*(?:true|:|exit(?:\s+0)?)\s*(?:$|[;&|)])|;\s*(?:true|:|exit\s+0)\s*$|\bset\s+\+e\b/;
const RUNNER_CONFIG =
  /^(?:jest|vitest|vitest\.workspace|playwright|cypress|ava)\.config\.[cm]?[jt]s$|^\.(?:mocharc|nycrc|c8rc)(?:\.[a-z]+)?$|^(?:pytest\.ini|tox\.ini|setup\.cfg|conftest\.py|pyproject\.toml)$/;
const MAKEFILE = /^(?:GNUmakefile|makefile|Makefile)$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const EXIT_ZERO = /\b(?:process\.exit|sys\.exit|os\.Exit|exit)\(\s*0\s*\)/;
const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const BUILTIN_SCRIPTS = new Set(["test", "t", "tst"]);

export const looksLikeTest = (run: string): boolean => TEST_COMMAND.test(run);

export const masksExit = (run: string): boolean => MASKED_EXIT.test(run.trim());

export const scriptsRun = (run: string): readonly string[] =>
  parseShell(run).flatMap((command) => {
    const [tool, first, second] = command.argv;
    if (tool === undefined || !PACKAGE_RUNNERS.has(tool)) return [];
    if (first === "run" || first === "run-script") return second === undefined ? [] : [second];
    if (first !== undefined && BUILTIN_SCRIPTS.has(first)) return ["test"];
    return tool === "yarn" || tool === "pnpm" ? (first === undefined ? [] : [first]) : [];
  });

const scriptOf = (content: string | undefined, name: string): string | undefined => {
  if (content === undefined) return undefined;
  const parsed = parseJsonObject(content);
  const scripts = parsed.ok ? parsed.value["scripts"] : undefined;
  const value = isRecord(scripts) ? scripts[name] : undefined;
  return typeof value === "string" ? value : undefined;
};

export interface PinnedChange {
  readonly key: string;
  readonly diff: string;
}

const working = (ctx: Pick<GateContext, "runtime" | "paths">, path: string): string | undefined => {
  const text = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, path)));
  return text.ok ? text.value : undefined;
};

const isPinnedFile = (path: string): boolean => {
  const posix = toPosixPath(path);
  const name = posix.split("/").pop() ?? "";
  return RUNNER_CONFIG.test(name) || MAKEFILE.test(name) || WORKFLOW.test(posix);
};

const SHORT = 60;
const short = (text: string | undefined): string =>
  text === undefined ? "(none)" : text.length > SHORT ? `${text.slice(0, SHORT)}…` : text;

const fileDigest = (path: string, content: string | undefined): string | undefined =>
  isProtectedConfig(path) ? configDigest(path, content) : content;

export const pinnedChanges = (
  ctx: Pick<GateContext, "runtime" | "paths" | "git" | "base" | "changes">,
  run: string,
): readonly PinnedChange[] => {
  const names = scriptsRun(run);
  const before = names.length === 0 ? undefined : fileAt(ctx.git, ctx.base, "package.json");
  const after = names.length === 0 ? undefined : working(ctx, "package.json");
  const scripts = names.flatMap((name): readonly PinnedChange[] => {
    const old = scriptOf(before, name);
    const now = scriptOf(after, name);
    return old === now ? [] : [{ key: `package.json scripts.${name}`, diff: `${short(old)} -> ${short(now)}` }];
  });
  const files = (looksLikeTest(run) ? ctx.changes : [])
    .filter((change) => isPinnedFile(change.path))
    .flatMap((change): readonly PinnedChange[] => {
      const old = fileDigest(change.path, fileAt(ctx.git, ctx.base, change.oldPath ?? change.path));
      const now = fileDigest(change.path, change.status === "D" ? undefined : working(ctx, change.path));
      return old === now ? [] : [{ key: change.path, diff: change.status === "A" ? "added" : change.status }];
    });
  return [...scripts, ...files];
};

export const exitZeroAdded = (ctx: Pick<GateContext, "git" | "base">): readonly string[] => [
  ...new Set(
    addedLines(ctx.git, ctx.base)
      .filter((line) => !isTestFile(line.path) && EXIT_ZERO.test(line.text))
      .map((line) => `${line.path}:${String(line.line)}`),
  ),
];

export const referenceCount = (
  ctx: Pick<GateContext, "runtime" | "paths" | "contract" | "baseline">,
  checkId: string,
  run: string,
): number | undefined => {
  const recorded = ctx.baseline?.[checkId]?.testCount;
  if (recorded !== undefined) return recorded;
  return readLedger(ctx.runtime, ctx.paths.evidence(ctx.contract.id)).find(
    (entry) => entry.check === checkId && entry.command === run && entry.testCount !== undefined,
  )?.testCount;
};
