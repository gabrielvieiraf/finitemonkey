import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { KNOWN_GUARDS, STARTS_IN_SHADOW } from "../policy/policy.js";
import { type PublishedVersion, registryVersion } from "./registry.js";
import { levelMode } from "../policy/levels.js";
import { DEFAULT_POLICY, KNOWN_GUARDS, STARTS_IN_SHADOW } from "../policy/policy.js";
import type { FeatureDefault, IssueFact, ProjectState } from "./resolve.js";

export interface CommandEntry {
  readonly path: readonly string[];
  readonly status: "ready" | "planned";
}

const RELEASE_HEADING = /^#{1,3}\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/m;
const CHANGELOGS = ["CHANGELOG.md", "CHANGELOG"] as const;

export const publishedIn = (changelog: string): string | undefined => RELEASE_HEADING.exec(changelog)?.[1];

const changelogVersion = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): PublishedVersion | undefined => {
  for (const name of CHANGELOGS) {
    const read = runtime.readText(toAbsolutePath(name, root));
    const version = read.ok ? publishedIn(read.value) : undefined;
    if (read.ok) return version === undefined ? undefined : { version, source: "changelog" };
  }
  return undefined;
};

export const publishedVersion = (
  runtime: Pick<Runtime, "readText" | "exec">,
  root: AbsolutePath,
  online: boolean,
): PublishedVersion | undefined =>
  (online ? registryVersion(runtime, root) : undefined) ?? changelogVersion(runtime, root);

export const featureDefaults = (): ReadonlyMap<string, FeatureDefault> =>
  new Map(
    KNOWN_GUARDS.map((id): [string, FeatureDefault] => [
      id,
      STARTS_IN_SHADOW.has(id) ? levelMode(id, DEFAULT_POLICY.level) : "active",
    ]),
  );

export const commandStatuses = (registry: readonly CommandEntry[]): ReadonlyMap<string, "ready" | "planned"> =>
  new Map(registry.map((spec): [string, "ready" | "planned"] => [spec.path.join(" "), spec.status]));

export const localState = (
  runtime: Pick<Runtime, "readText" | "exec">,
  root: AbsolutePath,
  registry: readonly CommandEntry[],
  issues: ReadonlyMap<number, IssueFact> | undefined,
): ProjectState => ({
  commands: commandStatuses(registry),
  features: featureDefaults(),
  published: publishedVersion(runtime, root, issues !== undefined),
  issues,
});
