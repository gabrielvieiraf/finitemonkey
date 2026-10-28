import type { AbsolutePath } from "../../core/brand.js";
import { isRecord, parseJson } from "../../core/parsed.js";
import { toPosixPath } from "../../core/posix-path.js";
import type { Runtime } from "../../core/runtime.js";
import type { Severity } from "./rules.js";

export interface ToolHit {
  readonly tool: "actionlint" | "zizmor";
  readonly rule: string;
  readonly severity: Severity;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

export interface ToolRun {
  readonly hits: readonly ToolHit[];
  readonly missing: readonly string[];
}

const TOOL_TIMEOUT_MS = 120_000;

type ToolRuntime = Pick<Runtime, "exec">;

const listOf = (stdout: string): readonly unknown[] => {
  const parsed = parseJson(stdout.trim() === "" ? "[]" : stdout);
  return parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
};

const relative = (root: AbsolutePath, file: string): string => {
  const posix = toPosixPath(file);
  const base = `${toPosixPath(root)}/`;
  return posix.startsWith(base) ? posix.slice(base.length) : posix;
};

const actionlint = (runtime: ToolRuntime, root: AbsolutePath, files: readonly string[]): ToolHit[] | undefined => {
  const run = runtime.exec({
    command: "actionlint",
    args: ["-format", "{{json .}}", ...files],
    cwd: root,
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  if (!run.found) return undefined;
  if (run.exitCode !== 0 && run.exitCode !== 1) return [failed("actionlint", "block", run.stderr)];
  return listOf(run.stdout).flatMap((item): ToolHit[] =>
    isRecord(item) && typeof item["message"] === "string"
      ? [
          {
            tool: "actionlint",
            rule: `actionlint/${typeof item["kind"] === "string" ? item["kind"] : "error"}`,
            severity: "block",
            file: relative(root, typeof item["filepath"] === "string" ? item["filepath"] : ""),
            line: typeof item["line"] === "number" ? item["line"] : 1,
            detail: item["message"],
          },
        ]
      : [],
  );
};

const failed = (tool: ToolHit["tool"], severity: Severity, stderr: string): ToolHit => ({
  tool,
  rule: `${tool}/failed`,
  severity,
  file: "",
  line: 1,
  detail: stderr.trim().split("\n")[0] ?? `${tool} failed`,
});

const at = (value: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);

const zizmorHit = (root: AbsolutePath, item: unknown): ToolHit | undefined => {
  const ident = at(item, "ident");
  if (typeof ident !== "string") return undefined;
  const locations = at(item, "locations");
  const first: unknown = Array.isArray(locations) ? locations[0] : undefined;
  const file = at(first, "symbolic", "key", "Local", "given_path");
  const row = at(first, "concrete", "location", "start_point", "row");
  const desc = at(item, "desc");
  return {
    tool: "zizmor",
    rule: `zizmor/${ident}`,
    severity: at(item, "determinations", "severity") === "High" ? "block" : "warn",
    file: relative(root, typeof file === "string" ? file : ""),
    line: typeof row === "number" ? row + 1 : 1,
    detail: typeof desc === "string" ? desc : ident,
  };
};

const zizmor = (runtime: ToolRuntime, root: AbsolutePath, files: readonly string[]): ToolHit[] | undefined => {
  const run = runtime.exec({
    command: "zizmor",
    args: ["--format=json", "--offline", ...files],
    cwd: root,
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  if (!run.found) return undefined;
  const hits = listOf(run.stdout).flatMap((item) => zizmorHit(root, item) ?? []);
  const known = run.exitCode === 0 || (run.exitCode !== null && run.exitCode >= 10 && run.exitCode <= 14);
  return known ? hits : [failed("zizmor", "warn", run.stderr)];
};

export const runTools = (runtime: ToolRuntime, root: AbsolutePath, files: readonly string[]): ToolRun => {
  if (files.length === 0) return { hits: [], missing: [] };
  const linted = actionlint(runtime, root, files);
  const zizmored = zizmor(runtime, root, files);
  return {
    hits: [...(linted ?? []), ...(zizmored ?? [])],
    missing: [...(linted === undefined ? ["actionlint"] : []), ...(zizmored === undefined ? ["zizmor"] : [])],
  };
};
