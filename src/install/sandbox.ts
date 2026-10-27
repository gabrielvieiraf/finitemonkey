import { isRecord, type JsonObject } from "../core/parsed.js";
import { DEFAULT_STYLE, parseSettings, renderJson, styleOf } from "./json-text.js";

export const SANDBOX_FILE = ".claude/settings.local.json";

export const DEFAULT_HOSTS = [
  "registry.npmjs.org",
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
] as const;

export const SANDBOX_PLATFORMS: readonly NodeJS.Platform[] = ["darwin", "linux"];

export const sandboxBlock = (root: string, hosts: readonly string[]): JsonObject => ({
  enabled: true,
  failIfUnavailable: true,
  filesystem: { denyRead: ["~/.ssh", "~/.aws", `${root}/.env`, `${root}/.env.*`] },
  network: { allowedDomains: [...hosts] },
});

export const withSandbox = (text: string | undefined, block: JsonObject): string | undefined => {
  const parsed = parseSettings(text);
  if (!parsed.ok) return undefined;
  if ("sandbox" in parsed.value) return text;
  return renderJson({ ...parsed.value, sandbox: block }, text === undefined ? DEFAULT_STYLE : styleOf(text));
};

export const withoutSandbox = (text: string, added: JsonObject): string | undefined => {
  const parsed = parseSettings(text);
  if (!parsed.ok) return text;
  const current = parsed.value["sandbox"];
  if (!isRecord(current) || JSON.stringify(current) !== JSON.stringify(added)) return text;
  const rest = Object.fromEntries(Object.entries(parsed.value).filter(([key]) => key !== "sandbox"));
  return Object.keys(rest).length === 0 ? undefined : renderJson(rest, styleOf(text));
};
