import { toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

export interface PullRequest {
  readonly title: string;
  readonly body: string;
}

export const pullRequestOf = (runtime: Pick<Runtime, "readText">, env: Env): PullRequest | undefined => {
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
