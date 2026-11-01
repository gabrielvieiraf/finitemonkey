import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { loadPolicy } from "../policy/policy.js";
import { ghJson, githubProject, type ProjectTarget } from "./github-project.js";
import type { Front, FrontsState } from "./state.js";

export const FRONTS_GITHUB_FEATURE = "fronts-github";
const GH_TIMEOUT_MS = 20_000;

export interface IssueComment {
  readonly issue: number;
  readonly status: string;
  readonly body: string;
}

export interface FieldWrite {
  readonly itemId: string;
  readonly value: string;
}

export interface GithubPlan {
  readonly repo: string;
  readonly comments: readonly IssueComment[];
  readonly project: ProjectTarget | undefined;
  readonly fields: readonly FieldWrite[];
}

export interface GithubWritten {
  readonly comments: number;
  readonly fields: number;
}

export const githubWritesOn = (runtime: Runtime, root: AbsolutePath): boolean => {
  const policy = loadPolicy(runtime, root);
  return policy.guards[FRONTS_GITHUB_FEATURE] === "active" || policy.userGuards[FRONTS_GITHUB_FEATURE] === "active";
};

const ledgerPath = (root: AbsolutePath): AbsolutePath =>
  toAbsolutePath(join(root, ".finitemonkey", "cache", "github-writes.json"));

const postedStatuses = (runtime: Runtime, root: AbsolutePath): Readonly<Record<string, unknown>> => {
  const text = runtime.readText(ledgerPath(root));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return parsed?.ok === true ? parsed.value : {};
};

const commentFor = (t: Translate, front: Front): string =>
  [
    t("fronts.github.comment", { front: front.id, status: front.status }),
    ...(front.lastReport === null ? [] : [t("fronts.github.comment_report", { report: front.lastReport })]),
  ].join("\n\n");

export const planGithubWrites = (
  runtime: Runtime,
  root: AbsolutePath,
  state: FrontsState,
  options: { readonly project: string | undefined; readonly field: string; readonly t: Translate },
): GithubPlan | undefined => {
  const view = ghJson(runtime, root, ["repo", "view", "--json", "nameWithOwner"]);
  const repo = isRecord(view) ? view["nameWithOwner"] : undefined;
  if (typeof repo !== "string" || repo === "") return undefined;
  const posted = postedStatuses(runtime, root);
  const linked = state.fronts.filter((front) => front.issue !== null);
  const comments = linked
    .filter((front) => posted[String(front.issue)] !== front.status)
    .map((front) => ({ issue: front.issue ?? 0, status: front.status, body: commentFor(options.t, front) }));
  const project =
    options.project === undefined ? undefined : githubProject(runtime, root, options.project, options.field);
  const fields = (project?.items ?? []).flatMap((item) => {
    const front = linked.find((candidate) => candidate.issue === item.issue);
    return front === undefined ? [] : [{ itemId: item.id, value: `${front.id}: ${front.status}` }];
  });
  return { repo, comments, project, fields };
};

const gh = (runtime: Runtime, root: AbsolutePath, args: readonly string[]): boolean => {
  const result = runtime.exec({ command: "gh", args, cwd: root, timeoutMs: GH_TIMEOUT_MS });
  return result.found && result.exitCode === 0;
};

export const applyGithubWrites = (runtime: Runtime, root: AbsolutePath, plan: GithubPlan): GithubWritten => {
  const posted = { ...postedStatuses(runtime, root) };
  let comments = 0;
  for (const item of plan.comments) {
    if (!gh(runtime, root, ["issue", "comment", String(item.issue), "--body", item.body])) continue;
    posted[String(item.issue)] = item.status;
    comments += 1;
  }
  runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey", "cache")));
  runtime.writeAtomic(ledgerPath(root), `${JSON.stringify(posted, null, 2)}\n`);
  const project = plan.project;
  const fields =
    project === undefined
      ? 0
      : plan.fields.filter((write) =>
          gh(runtime, root, [
            ...["project", "item-edit", "--id", write.itemId, "--project-id", project.projectId],
            ...["--field-id", project.fieldId, "--text", write.value],
          ]),
        ).length;
  return { comments, fields };
};
