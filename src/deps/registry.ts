import type { AbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { ExecRequest, ExecResult } from "../core/runtime.js";
import type { Ecosystem, RequestedPackage } from "./install-command.js";

export const REGISTRY_HOSTS: Readonly<Record<Ecosystem, string>> = {
  npm: "registry.npmjs.org",
  pypi: "pypi.org",
};

export interface PackageFacts {
  readonly createdMs: number | undefined;
  readonly versionCount: number;
  readonly version: string | undefined;
  readonly versionMs: number | undefined;
  readonly installScript: boolean;
  readonly previousInstallScript: boolean;
}

export type Lookup =
  | { readonly kind: "found"; readonly facts: PackageFacts }
  | { readonly kind: "missing" }
  | { readonly kind: "unreachable" };

const urlFor = (pkg: Pick<RequestedPackage, "ecosystem" | "name">): string =>
  pkg.ecosystem === "npm"
    ? `https://${REGISTRY_HOSTS.npm}/${pkg.name.replace("/", "%2F")}`
    : `https://${REGISTRY_HOSTS.pypi}/pypi/${encodeURIComponent(pkg.name)}/json`;

export const registryRequest = (
  pkg: Pick<RequestedPackage, "ecosystem" | "name">,
  cwd: AbsolutePath,
  timeoutMs: number,
): ExecRequest => ({
  command: "curl",
  args: [
    "--silent",
    "--show-error",
    "--location",
    "--proto",
    "=https",
    "--max-time",
    (Math.max(1, timeoutMs) / 1000).toFixed(1),
    "--write-out",
    "\n%{http_code}",
    urlFor(pkg),
  ],
  cwd,
  timeoutMs: timeoutMs + 500,
});

const timeOf = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const record = (value: unknown, key: string): JsonObject => {
  const inner = isRecord(value) ? value[key] : undefined;
  return isRecord(inner) ? inner : {};
};

const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"] as const;

const hasInstallScript = (manifest: JsonObject): boolean => {
  if (manifest["hasInstallScript"] === true) return true;
  const scripts = record(manifest, "scripts");
  return INSTALL_SCRIPTS.some((name) => typeof scripts[name] === "string");
};

const npmFacts = (doc: JsonObject, wanted: string | undefined): PackageFacts => {
  const times = record(doc, "time");
  const versions = record(doc, "versions");
  const tags = record(doc, "dist-tags");
  const tagged = wanted === undefined ? tags["latest"] : (tags[wanted] ?? wanted);
  const version = typeof tagged === "string" && tagged in versions ? tagged : undefined;
  const ordered = Object.keys(versions).sort((left, right) => (timeOf(times[left]) ?? 0) - (timeOf(times[right]) ?? 0));
  const index = version === undefined ? -1 : ordered.indexOf(version);
  const previous = index > 0 ? ordered[index - 1] : undefined;
  return {
    createdMs: timeOf(times["created"]),
    versionCount: ordered.length,
    version,
    versionMs: version === undefined ? undefined : timeOf(times[version]),
    installScript: version === undefined ? false : hasInstallScript(record(versions, version)),
    previousInstallScript: previous === undefined ? false : hasInstallScript(record(versions, previous)),
  };
};

const uploadMs = (files: unknown): number | undefined => {
  if (!Array.isArray(files)) return undefined;
  const times = files.flatMap((file: unknown) => {
    const time = isRecord(file) ? timeOf(file["upload_time_iso_8601"] ?? file["upload_time"]) : undefined;
    return time === undefined ? [] : [time];
  });
  return times.length === 0 ? undefined : Math.min(...times);
};

const pypiFacts = (doc: JsonObject, wanted: string | undefined): PackageFacts => {
  const releases = record(doc, "releases");
  const latest = record(doc, "info")["version"];
  const chosen = wanted ?? (typeof latest === "string" ? latest : undefined);
  const version = chosen !== undefined && chosen in releases ? chosen : undefined;
  const uploads = Object.values(releases).flatMap((files) => {
    const time = uploadMs(files);
    return time === undefined ? [] : [time];
  });
  return {
    createdMs: uploads.length === 0 ? undefined : Math.min(...uploads),
    versionCount: uploads.length,
    version,
    versionMs: version === undefined ? undefined : uploadMs(releases[version]),
    installScript: false,
    previousInstallScript: false,
  };
};

export const lookupOf = (pkg: Pick<RequestedPackage, "ecosystem" | "version">, result: ExecResult): Lookup => {
  if (!result.found || result.exitCode !== 0) return { kind: "unreachable" };
  const lines = result.stdout.trimEnd().split("\n");
  const status = Number.parseInt(lines.at(-1) ?? "", 10);
  if (status === 404) return { kind: "missing" };
  if (status < 200 || status >= 300) return { kind: "unreachable" };
  const doc = parseJsonObject(lines.slice(0, -1).join("\n"));
  if (!doc.ok) return { kind: "unreachable" };
  const facts = pkg.ecosystem === "npm" ? npmFacts(doc.value, pkg.version) : pypiFacts(doc.value, pkg.version);
  return { kind: "found", facts };
};
