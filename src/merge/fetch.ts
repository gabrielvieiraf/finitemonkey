import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { MERGE_FETCH_FEATURE } from "../policy/merge-guards.js";
import { fmPaths } from "../task/paths.js";

const FETCH_TIMEOUT_MS = 60_000;

const line = (runtime: Runtime, cwd: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, cwd);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

export interface BaseFetch {
  readonly upstream: string;
  readonly fetched: boolean;
  readonly behind: number;
}

export const fetchBase = (runtime: Runtime, cwd: AbsolutePath, target: string | undefined): BaseFetch | undefined => {
  const branch = target ?? line(runtime, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch === undefined) return undefined;
  const upstream = line(runtime, cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{upstream}`]);
  if (upstream === undefined) return undefined;
  const paths = fmPaths(cwd);
  const mode = featureMode(runtime, paths, MERGE_FETCH_FEATURE);
  if (mode === "shadow") recordFeatureShadow(runtime, paths, MERGE_FETCH_FEATURE, { target: branch, upstream });
  if (mode !== "active") return undefined;
  const [remote = "origin", ...rest] = upstream.split("/");
  const fetched = runtime.gitWith(["fetch", "--quiet", "--no-tags", remote, rest.join("/")], cwd, {
    timeoutMs: FETCH_TIMEOUT_MS,
  }).ok;
  const behind = Number.parseInt(line(runtime, cwd, ["rev-list", "--count", `${branch}..${upstream}`]) ?? "0", 10);
  return { upstream, fetched, behind: Number.isNaN(behind) ? 0 : behind };
};

export const fetchNotes = (fetch: BaseFetch | undefined, target: string): readonly string[] => {
  if (fetch === undefined) return [];
  if (!fetch.fetched) return [`could not fetch ${fetch.upstream}; merged against the local ${target}`];
  return fetch.behind === 0
    ? []
    : [
        `base moved: ${fetch.upstream} is ${String(fetch.behind)} commits ahead of ${target}; merged into the local ${target}`,
      ];
};
