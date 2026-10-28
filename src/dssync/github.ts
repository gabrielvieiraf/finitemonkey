import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { replaceMarked } from "./issue.js";

const GH_TIMEOUT_MS = 30_000;

export type IssueAction = "created" | "updated" | "unchanged" | "failed";

interface FoundIssue {
  readonly number: number;
  readonly body: string;
}

const gh = (runtime: Runtime, cwd: AbsolutePath, args: readonly string[], input?: string) =>
  runtime.exec({ command: "gh", args, cwd, timeoutMs: GH_TIMEOUT_MS, ...(input === undefined ? {} : { input }) });

const findIssue = (runtime: Runtime, cwd: AbsolutePath, title: string): FoundIssue | undefined | "error" => {
  const listed = gh(runtime, cwd, [
    "issue",
    "list",
    "--state",
    "all",
    "--search",
    `"${title}" in:title`,
    "--json",
    "number,title,body",
    "--limit",
    "20",
  ]);
  if (!listed.found || listed.exitCode !== 0) return "error";
  const parsed = parseJson(listed.stdout);
  const items: readonly unknown[] = parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
  const match = items.find((item: unknown) => isRecord(item) && item["title"] === title);
  if (!isRecord(match) || typeof match["number"] !== "number") return undefined;
  return { number: match["number"], body: typeof match["body"] === "string" ? match["body"] : "" };
};

export const upsertIssue = (runtime: Runtime, cwd: AbsolutePath, title: string, section: string): IssueAction => {
  const found = findIssue(runtime, cwd, title);
  if (found === "error") return "failed";
  if (found === undefined) {
    const made = gh(runtime, cwd, ["issue", "create", "--title", title, "--body-file", "-"], section);
    return made.found && made.exitCode === 0 ? "created" : "failed";
  }
  const body = replaceMarked(found.body, section);
  if (body === found.body) return "unchanged";
  const edited = gh(runtime, cwd, ["issue", "edit", String(found.number), "--body-file", "-"], body);
  return edited.found && edited.exitCode === 0 ? "updated" : "failed";
};
