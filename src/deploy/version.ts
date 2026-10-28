import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

export const VERSION_TIMEOUT_MS = 10_000;
const COMMIT = /^[0-9a-f]{7,40}$/i;
const COMMIT_KEYS = ["commit", "sha", "git_sha", "gitSha", "commit_sha", "commitSha", "revision", "version"];

export type LiveRead =
  | { readonly kind: "answered"; readonly status: number; readonly commit?: string }
  | { readonly kind: "unreachable"; readonly detail: string };

const at = (value: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);

const asCommit = (value: unknown): string | undefined =>
  typeof value === "string" && COMMIT.test(value.trim()) ? value.trim().toLowerCase() : undefined;

export const commitIn = (body: string, field: string | undefined): string | undefined => {
  const parsed = parseJsonObject(body);
  if (parsed.ok) {
    if (field !== undefined) return asCommit(at(parsed.value, field.split(".")));
    return COMMIT_KEYS.map((key) => asCommit(parsed.value[key])).find((found) => found !== undefined);
  }
  return asCommit(body.trim().split(/\s+/)[0]);
};

export const readVersion = (
  runtime: Pick<Runtime, "exec">,
  cwd: AbsolutePath,
  url: string,
  field: string | undefined,
): LiveRead => {
  const result = runtime.exec({
    command: "curl",
    args: [
      "--silent",
      "--show-error",
      "--location",
      "--proto",
      "=https,http",
      "--max-time",
      String(VERSION_TIMEOUT_MS / 1000),
      "--write-out",
      "\n%{http_code}",
      url,
    ],
    cwd,
    timeoutMs: VERSION_TIMEOUT_MS + 1000,
  });
  if (!result.found) return { kind: "unreachable", detail: "curl not found" };
  const lines = result.stdout.replace(/\r?\n$/, "").split(/\r?\n/);
  const status = Number.parseInt(lines.at(-1) ?? "", 10);
  if (result.exitCode !== 0 || !Number.isInteger(status) || status === 0) {
    return { kind: "unreachable", detail: (result.stderr.trim() || `exit ${String(result.exitCode)}`).slice(0, 200) };
  }
  const commit = commitIn(lines.slice(0, -1).join("\n"), field);
  return { kind: "answered", status, ...(commit === undefined ? {} : { commit }) };
};

export const sameCommit = (live: string | undefined, expected: string): boolean => {
  if (live === undefined || live.length < 7) return false;
  const a = live.toLowerCase();
  const b = expected.toLowerCase();
  return a.startsWith(b) || b.startsWith(a);
};
