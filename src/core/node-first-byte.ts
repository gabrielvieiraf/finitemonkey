import { spawnSync } from "node:child_process";

import { isRecord, parseJson } from "./parsed.js";
import type { ExecRequest, ExecResult } from "./runtime.js";

export interface FirstByteTarget {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean;
}

const WRAPPER_GRACE_MS = 5_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export const FIRST_BYTE_SCRIPT = [
  'const { spawn } = require("node:child_process");',
  'let raw = "";',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", (chunk) => { raw += chunk; });',
  'process.stdin.on("end", () => {',
  "  const job = JSON.parse(raw);",
  "  const started = Date.now();",
  '  let first = null, out = "", err = "", timedOut = false, done = false, missing = false;',
  "  const finish = (code) => {",
  "    if (done) return;",
  "    done = true;",
  "    process.stdout.write(JSON.stringify({ code, out, err, first, timedOut, missing, duration: Date.now() - started }));",
  "  };",
  "  const mark = () => { if (first === null) first = Date.now() - started; };",
  '  const child = spawn(job.command, job.args, { cwd: job.cwd, shell: job.shell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });',
  '  child.stdout.setEncoding("utf8");',
  '  child.stderr.setEncoding("utf8");',
  '  child.stdout.on("data", (chunk) => { mark(); out += chunk; });',
  '  child.stderr.on("data", (chunk) => { mark(); err += chunk; });',
  '  child.stdin.on("error", () => undefined);',
  '  child.on("error", (error) => { missing = error.code === "ENOENT"; finish(null); });',
  '  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, job.timeoutMs);',
  '  child.on("close", (code) => { clearTimeout(timer); finish(code); });',
  '  child.stdin.end(job.input ?? "");',
  "});",
].join("\n");

const numberOr = (value: unknown, fallback: number | null): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const parseFirstByte = (stdout: string, elapsedMs: number): ExecResult | undefined => {
  const parsed = parseJson(stdout.trim());
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const job = parsed.value;
  const first = numberOr(job["first"], null);
  return {
    found: job["missing"] !== true,
    exitCode: numberOr(job["code"], null),
    stdout: typeof job["out"] === "string" ? job["out"] : "",
    stderr: typeof job["err"] === "string" ? job["err"] : "",
    timedOut: job["timedOut"] === true,
    durationMs: numberOr(job["duration"], elapsedMs) ?? elapsedMs,
    ...(first === null ? {} : { firstOutputMs: first }),
  };
};

export const execFirstByte = (
  request: ExecRequest,
  target: FirstByteTarget,
  env: Readonly<Record<string, string | undefined>>,
): ExecResult | undefined => {
  const started = Date.now();
  const job = { ...target, cwd: request.cwd, timeoutMs: request.timeoutMs, input: request.input ?? "" };
  const result = spawnSync(process.execPath, ["-e", FIRST_BYTE_SCRIPT], {
    cwd: request.cwd,
    encoding: "utf8",
    env,
    input: JSON.stringify(job),
    timeout: request.timeoutMs + WRAPPER_GRACE_MS,
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  });
  return typeof result.stdout === "string" ? parseFirstByte(result.stdout, Date.now() - started) : undefined;
};
