import type { AbsolutePath } from "../../core/brand.js";
import { isRecord, parseJson } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { configAt, configList, loadProjectConfig } from "../../git/project-config.js";
import { gh, type GhRuntime } from "./state.js";

export const DEFAULT_ENVIRONMENT = "production";

export interface EnvironmentPlan {
  readonly name: string;
  readonly wanted: readonly string[];
  readonly current: readonly string[];
}

interface Reviewer {
  readonly type: "User" | "Team";
  readonly id: number;
}

const unique = (items: readonly string[]): readonly string[] => [...new Set(items)].sort();

const wantedReviewers = (runtime: Runtime, root: AbsolutePath): readonly string[] =>
  unique(
    configList(loadProjectConfig(runtime, root), "deploy", "reviewers")
      .flatMap((item) => item.split(","))
      .map((item) => item.trim().replace(/^@/, ""))
      .filter((item) => item !== ""),
  );

const environmentName = (runtime: Runtime, root: AbsolutePath): string => {
  const name = configAt(loadProjectConfig(runtime, root), "deploy", "environment");
  return typeof name === "string" && name.trim() !== "" ? name.trim() : DEFAULT_ENVIRONMENT;
};

const list = (value: unknown, key: string): readonly unknown[] => {
  const inner = isRecord(value) ? value[key] : undefined;
  return Array.isArray(inner) ? inner : [];
};

const reviewerName = (owner: string, item: unknown): readonly string[] => {
  const reviewer = isRecord(item) ? item["reviewer"] : undefined;
  if (!isRecord(reviewer)) return [];
  if (typeof reviewer["login"] === "string") return [reviewer["login"]];
  return typeof reviewer["slug"] === "string" ? [`${owner}/${reviewer["slug"]}`] : [];
};

export const currentReviewers = (body: unknown, owner: string): readonly string[] =>
  unique(
    list(body, "protection_rules")
      .filter((rule) => isRecord(rule) && rule["type"] === "required_reviewers")
      .flatMap((rule) => list(rule, "reviewers").flatMap((item) => reviewerName(owner, item))),
  );

const environmentPath = (repo: string, name: string): string =>
  `repos/${repo}/environments/${encodeURIComponent(name)}`;

export const environmentPlan = (runtime: Runtime, root: AbsolutePath, repo: string): EnvironmentPlan | undefined => {
  const wanted = wantedReviewers(runtime, root);
  if (wanted.length === 0) return undefined;
  const name = environmentName(runtime, root);
  const read = gh(runtime, root, ["api", environmentPath(repo, name)]);
  const parsed = read.exitCode === 0 ? parseJson(read.stdout) : undefined;
  const owner = repo.split("/")[0] ?? "";
  return { name, wanted, current: parsed?.ok === true ? currentReviewers(parsed.value, owner) : [] };
};

export const reviewersSummary = (name: string, reviewers: readonly string[]): string =>
  `${name}: ${reviewers.length === 0 ? "none" : reviewers.join(", ")}`;

const idOf = (runtime: GhRuntime, root: AbsolutePath, path: string): number | undefined => {
  const result = gh(runtime, root, ["api", path, "--jq", ".id"]);
  const id = Number(result.stdout.trim());
  return result.exitCode === 0 && Number.isInteger(id) && id > 0 ? id : undefined;
};

const reviewerOf = (runtime: GhRuntime, root: AbsolutePath, name: string): Reviewer | undefined => {
  const [org, slug] = name.split("/");
  const team = slug !== undefined && org !== undefined;
  const id = idOf(runtime, root, team ? `orgs/${org}/teams/${slug}` : `users/${name}`);
  return id === undefined ? undefined : { type: team ? "Team" : "User", id };
};

export const applyReviewers = (
  runtime: GhRuntime,
  root: AbsolutePath,
  repo: string,
  plan: EnvironmentPlan,
): boolean => {
  const reviewers = plan.wanted.map((name) => reviewerOf(runtime, root, name));
  const found = reviewers.filter((item): item is Reviewer => item !== undefined);
  if (found.length !== reviewers.length) return false;
  const body = JSON.stringify({ reviewers: found });
  return (
    gh(runtime, root, ["api", "--method", "PUT", environmentPath(repo, plan.name), "--input", "-"], body).exitCode === 0
  );
};
