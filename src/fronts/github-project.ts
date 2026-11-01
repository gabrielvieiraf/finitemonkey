import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

const GH_TIMEOUT_MS = 20_000;

export const ghJson = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): unknown => {
  const result = runtime.exec({ command: "gh", args, cwd: root, timeoutMs: GH_TIMEOUT_MS });
  if (!result.found || result.exitCode !== 0) return undefined;
  const parsed = parseJson(result.stdout);
  return parsed.ok ? parsed.value : undefined;
};

export interface ProjectItem {
  readonly id: string;
  readonly issue: number;
}

export interface ProjectTarget {
  readonly number: string;
  readonly projectId: string;
  readonly fieldId: string;
  readonly field: string;
  readonly items: readonly ProjectItem[];
}

const listOf = (value: unknown, key: string): readonly unknown[] => {
  const list = isRecord(value) ? value[key] : undefined;
  return Array.isArray(list) ? list : [];
};

const itemOf = (value: unknown): ProjectItem | undefined => {
  const content = isRecord(value) ? value["content"] : undefined;
  if (!isRecord(value) || !isRecord(content) || content["type"] !== "Issue") return undefined;
  const { id } = value;
  const { number } = content;
  return typeof id === "string" && typeof number === "number" ? { id, issue: number } : undefined;
};

export const githubProject = (
  runtime: Runtime,
  root: AbsolutePath,
  number: string,
  field: string,
): ProjectTarget | undefined => {
  const repo = ghJson(runtime, root, ["repo", "view", "--json", "owner"]);
  const owner = isRecord(repo) && isRecord(repo["owner"]) ? repo["owner"]["login"] : undefined;
  if (typeof owner !== "string") return undefined;
  const scope = ["--owner", owner, "--format", "json"];
  const view = ghJson(runtime, root, ["project", "view", number, ...scope]);
  const projectId = isRecord(view) ? view["id"] : undefined;
  const found = listOf(ghJson(runtime, root, ["project", "field-list", number, ...scope]), "fields").find(
    (item) => isRecord(item) && item["name"] === field,
  );
  const fieldId = isRecord(found) ? found["id"] : undefined;
  if (typeof projectId !== "string" || typeof fieldId !== "string") return undefined;
  const items = listOf(ghJson(runtime, root, ["project", "item-list", number, ...scope, "--limit", "1000"]), "items");
  return { number, projectId, fieldId, field, items: items.flatMap((item) => itemOf(item) ?? []) };
};
