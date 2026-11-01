import { EXCLUDE_FM } from "../gate/git.js";
import type { GateContext } from "../gate/types.js";
import type { DetectorSources, PythonRunner } from "./detector-sources.js";
import { baseText, changedPaths, readWorking } from "./gate-sources.js";
import { parsePythonMetrics, PYTHON_METRICS_SCRIPT } from "./python-metrics.js";

const PYTHON_TIMEOUT_MS = 10_000;
const MAX_CONFIRM = 40;
const NOT_SOURCE = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "*.md",
];

const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const referencedBy = (ctx: GateContext) => (name: string, exclude: readonly string[]) => {
  const skip = [
    ...NOT_SOURCE.map((glob) => `:(exclude,glob)**/${glob}`),
    ...exclude.map((file) => `:(exclude)${file}`),
  ];
  const found = ctx.git.out(["grep", "--untracked", "-l", "-F", "-e", name, "--", ".", ...skip, EXCLUDE_FM]);
  const word = new RegExp(`(?<![\\w-])${escaped(name)}(?![\\w-])`);
  return (found ?? "")
    .split("\n")
    .filter((file) => file !== "")
    .slice(0, MAX_CONFIRM)
    .some((file) => word.test(readWorking(ctx, file) ?? ""));
};

export const pythonRunner = (ctx: Pick<GateContext, "runtime" | "paths">): PythonRunner => {
  let missing = false;
  return (text) => {
    if (missing) return undefined;
    const result = ctx.runtime.exec({
      command: "python3",
      args: ["-c", PYTHON_METRICS_SCRIPT],
      cwd: ctx.paths.root,
      timeoutMs: PYTHON_TIMEOUT_MS,
      input: text,
    });
    if (!result.found) missing = true;
    if (!result.found || result.timedOut || result.exitCode !== 0) return undefined;
    return parsePythonMetrics(result.stdout);
  };
};

export const detectorSources = (ctx: GateContext): DetectorSources => ({
  changed: changedPaths(ctx),
  before: (file) => baseText(ctx, file),
  after: (file) => readWorking(ctx, file),
  referenced: referencedBy(ctx),
  python: pythonRunner(ctx),
});
