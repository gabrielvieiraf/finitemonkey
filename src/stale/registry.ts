import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

export interface PublishedVersion {
  readonly version: string;
  readonly source: "changelog" | "registry";
  readonly tag?: string;
}

const NPM_TIMEOUT_MS = 20_000;
const PREFERRED_TAGS = ["latest", "next"] as const;

export const packageName = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): string | undefined => {
  const read = runtime.readText(toAbsolutePath("package.json", root));
  const parsed = read.ok ? parseJsonObject(read.value) : undefined;
  if (parsed?.ok !== true || parsed.value["private"] === true) return undefined;
  const name = parsed.value["name"];
  return typeof name === "string" && name !== "" ? name : undefined;
};

export const fromDistTags = (stdout: string): PublishedVersion | undefined => {
  const parsed = parseJsonObject(stdout);
  if (!parsed.ok) return undefined;
  const tags = Object.entries(parsed.value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const chosen = PREFERRED_TAGS.map((tag) => tags.find(([name]) => name === tag)).find((entry) => entry !== undefined);
  const [tag, version] = chosen ?? tags[0] ?? [];
  return tag === undefined || version === undefined ? undefined : { version, source: "registry", tag };
};

export const registryVersion = (
  runtime: Pick<Runtime, "readText" | "exec">,
  root: AbsolutePath,
): PublishedVersion | undefined => {
  const name = packageName(runtime, root);
  if (name === undefined) return undefined;
  const result = runtime.exec({
    command: "npm",
    args: ["view", name, "dist-tags", "--json"],
    cwd: root,
    timeoutMs: NPM_TIMEOUT_MS,
  });
  return result.found && result.exitCode === 0 ? fromDistTags(result.stdout) : undefined;
};
