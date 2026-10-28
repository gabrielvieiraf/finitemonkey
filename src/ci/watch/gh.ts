import type { AbsolutePath } from "../../core/brand.js";
import { isRecord, parseJson } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { maskText } from "../../mask/mask.js";

const GH_TIMEOUT_MS = 30_000;
const LOG_TAIL_LINES = 120;

export const BUCKETS = ["pass", "fail", "pending", "skipping", "cancel"] as const;

export type Bucket = (typeof BUCKETS)[number];

export interface CheckState {
  readonly name: string;
  readonly bucket: Bucket;
  readonly link: string;
}

export interface PullRequest {
  readonly number: number;
  readonly sha: string;
  readonly url: string;
}

export interface GhCounter {
  calls: number;
}

type GhRuntime = Pick<Runtime, "exec">;

const ghJson = (
  runtime: GhRuntime,
  root: AbsolutePath,
  counter: GhCounter,
  args: readonly string[],
): { readonly ok: boolean; readonly value: unknown; readonly stdout: string } => {
  counter.calls += 1;
  const result = runtime.exec({ command: "gh", args, cwd: root, timeoutMs: GH_TIMEOUT_MS });
  const parsed = parseJson(result.stdout.trim() === "" ? "null" : result.stdout);
  return {
    ok: result.found && result.exitCode !== null,
    value: parsed.ok ? parsed.value : undefined,
    stdout: result.stdout,
  };
};

export const readPullRequest = (
  runtime: GhRuntime,
  root: AbsolutePath,
  counter: GhCounter,
  given: string | undefined,
): PullRequest | undefined => {
  const args = ["pr", "view", ...(given === undefined ? [] : [given]), "--json", "number,headRefOid,url"];
  const { value } = ghJson(runtime, root, counter, args);
  if (!isRecord(value) || typeof value["number"] !== "number" || typeof value["headRefOid"] !== "string")
    return undefined;
  return {
    number: value["number"],
    sha: value["headRefOid"],
    url: typeof value["url"] === "string" ? value["url"] : "",
  };
};

const bucketOf = (value: unknown): Bucket => BUCKETS.find((bucket) => bucket === value) ?? "pending";

export const readChecks = (
  runtime: GhRuntime,
  root: AbsolutePath,
  counter: GhCounter,
  pr: number,
): readonly CheckState[] | undefined => {
  const { ok, value } = ghJson(runtime, root, counter, ["pr", "checks", String(pr), "--json", "name,bucket,link"]);
  if (!ok || !Array.isArray(value)) return undefined;
  return value.flatMap((item: unknown): CheckState[] =>
    isRecord(item) && typeof item["name"] === "string"
      ? [
          {
            name: item["name"],
            bucket: bucketOf(item["bucket"]),
            link: typeof item["link"] === "string" ? item["link"] : "",
          },
        ]
      : [],
  );
};

const RUN_ID = /\/actions\/runs\/(\d+)/;

export const failedLog = (runtime: GhRuntime, root: AbsolutePath, counter: GhCounter, check: CheckState): string => {
  const id = RUN_ID.exec(check.link)?.[1];
  if (id === undefined) return "";
  const { stdout } = ghJson(runtime, root, counter, ["run", "view", id, "--log-failed"]);
  return maskText(stdout.split("\n").slice(-LOG_TAIL_LINES).join("\n"));
};
