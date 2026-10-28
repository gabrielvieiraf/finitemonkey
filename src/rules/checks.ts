import type { AbsolutePath } from "../core/brand.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { HookCheck } from "../githooks/checks.js";
import { readManifest, type Surface } from "./manifest.js";
import { pathMatches, textMatches } from "./match.js";
import { loadRules, type ProjectRule } from "./types.js";

const FIX = "follow the project rule named in the failure, or change it in .finitemonkey/rules.yml";
const RECORD = "\u0001";

export const compiledFor = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  surface: Surface,
): readonly ProjectRule[] => {
  const manifest = readManifest(runtime, root);
  const rules = loadRules(runtime, root);
  return rules.ok ? rules.value.filter((rule) => manifest.rules[rule.id]?.surfaces.includes(surface) === true) : [];
};

const failure = (rule: ProjectRule, where: string): string => `${where}: rule ${rule.id} (${rule.text})`;

export const commitRuleCheck = (rules: readonly ProjectRule[], message: string): HookCheck => ({
  id: "rules",
  failures: rules.filter((rule) => textMatches(rule, "commit", message)).map((rule) => failure(rule, "commit message")),
  fix: FIX,
});

interface PullRequest {
  readonly title: string;
  readonly body: string;
}

const pullRequestOf = (runtime: Pick<Runtime, "readText">, env: Env): PullRequest | undefined => {
  const path = env["GITHUB_EVENT_PATH"];
  if (path === undefined || path === "") return undefined;
  const text = runtime.readText(toAbsolutePath(path));
  const event = text.ok ? parseJsonObject(text.value) : undefined;
  const pr = event?.ok === true ? event.value["pull_request"] : undefined;
  if (!isRecord(pr)) return undefined;
  const title = pr["title"];
  const body = pr["body"];
  return { title: typeof title === "string" ? title : "", body: typeof body === "string" ? body : "" };
};

const commitsIn = (runtime: Pick<Runtime, "git">, root: AbsolutePath, base: string) => {
  const log = runtime.git(["log", "--no-merges", `--format=%h%x00%B${RECORD}`, `${base}..HEAD`, "--"], root);
  if (!log.ok) return [];
  return log.stdout
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.includes("\u0000"))
    .map((record) => {
      const [sha = "", body = ""] = record.split("\u0000");
      return { sha, body };
    });
};

const changedIn = (runtime: Pick<Runtime, "git">, root: AbsolutePath, base: string): readonly string[] => {
  const diff = runtime.git(["diff", "--name-only", `${base}...HEAD`, "--"], root);
  return diff.ok ? diff.stdout.split("\n").filter((line) => line !== "") : [];
};

export const ciRuleCheck = (
  runtime: Pick<Runtime, "readText" | "git">,
  root: AbsolutePath,
  env: Env,
  base: string,
): HookCheck => {
  const rules = compiledFor(runtime, root, "ci");
  const pr = pullRequestOf(runtime, env);
  const commits = commitsIn(runtime, root, base);
  const changed = changedIn(runtime, root, base);
  const failures = rules.flatMap((rule) => [
    ...(pr !== undefined && textMatches(rule, "pr", `${pr.title}\n\n${pr.body}`)
      ? [failure(rule, "pull request")]
      : []),
    ...commits.filter((commit) => textMatches(rule, "commit", commit.body)).map((commit) => failure(rule, commit.sha)),
    ...changed
      .filter((file) => rule.detector?.kind === "path" && pathMatches(rule, rule.detector.tools[0] ?? "Write", file))
      .map((file) => failure(rule, file)),
  ]);
  return { id: "rules", failures, fix: FIX };
};
