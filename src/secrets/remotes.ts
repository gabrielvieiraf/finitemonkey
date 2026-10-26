import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { scanText } from "./engine.js";
import { CREDENTIAL_RULES } from "./rules/catalog.js";

const USER_AND_SECRET = /^[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
const USERINFO = /^[a-z][a-z0-9+.-]*:\/\/(?<user>[^\s/@]+)@/i;

const hasCredential = (url: string): boolean => {
  if (USER_AND_SECRET.test(url)) return true;
  const user = USERINFO.exec(url)?.groups?.["user"];
  return user !== undefined && scanText(user, { rules: CREDENTIAL_RULES }).length > 0;
};

export const parseRemotes = (output: string): ReadonlyMap<string, readonly string[]> => {
  const remotes = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/)) {
    const [name, url] = line.trim().split(/\s+/);
    if (name === undefined || url === undefined || name === "") continue;
    remotes.set(name, [...(remotes.get(name) ?? []), url]);
  }
  return remotes;
};

export const remotesWithCredentials = (runtime: Pick<Runtime, "git">, root: AbsolutePath): readonly string[] => {
  const listed = runtime.git(["remote", "-v"], root);
  if (!listed.ok) return [];
  return [...parseRemotes(listed.stdout)]
    .filter(([, urls]) => urls.some(hasCredential))
    .map(([name]) => name)
    .sort();
};
