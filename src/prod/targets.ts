import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, type ConfigTree } from "../git/project-config.js";
import { normalizeCommand } from "../shell/normalize.js";
import { remoteHostsOf } from "./remote.js";

export interface ProdTargets {
  readonly hosts: ReadonlySet<string>;
  readonly kubeContexts: readonly string[];
  readonly dockerContexts: readonly string[];
  readonly deployPath: string | undefined;
}

const DEPLOY_FILES = [
  "deploy.sh",
  "scripts/deploy.sh",
  "docker-compose.prod.yml",
  "docker-compose.production.yml",
  "compose.prod.yml",
  "compose.production.yml",
] as const;

const SSH_URL = /ssh:\/\/(?:[^@\s/]+@)?([A-Za-z0-9.-]+)/g;
const HOST_KEY =
  /^\s*-?\s*(?:host|hostname|server|ssh_host|deploy_host|remote_host)\s*:\s*["']?([A-Za-z0-9][A-Za-z0-9.-]*)["']?\s*$/i;

export const hostKey = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^[^@]*@/, "")
    .replace(/^\[([^\]]+)\].*$/, "$1")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");

const shellLine = (line: string): string => line.replace(/^\s*(?:-\s*)?(?:run:\s*\|?)?/, "");

const hostsInText = (text: string): readonly string[] => {
  const urls = [...text.matchAll(SSH_URL)].map((match) => match[1] ?? "");
  const lines = text.split(/\r?\n/);
  const keyed = lines.flatMap((line) => {
    const match = HOST_KEY.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  const commands = lines.flatMap((line) => normalizeCommand(shellLine(line)).commands.flatMap(remoteHostsOf));
  return [...urls, ...keyed, ...commands].filter((host) => host !== "" && !host.includes("$"));
};

const workflowFiles = (runtime: Runtime, root: AbsolutePath): readonly string[] => {
  const listed = runtime.listDir(toAbsolutePath(join(root, ".github", "workflows")));
  if (!listed.ok) return [];
  return listed.value
    .filter((name) => /deploy/i.test(name) && /\.ya?ml$/i.test(name))
    .map((name) => `.github/workflows/${name}`);
};

const detectedHosts = (runtime: Runtime, root: AbsolutePath, files: readonly string[]): readonly string[] =>
  files.flatMap((file) => {
    const text = runtime.readText(toAbsolutePath(join(root, file)));
    return text.ok ? hostsInText(text.value) : [];
  });

export const loadProdTargets = (runtime: Runtime, root: AbsolutePath, config: ConfigTree): ProdTargets => {
  const workflows = workflowFiles(runtime, root);
  const deployFiles = [...workflows, ...DEPLOY_FILES];
  const hosts = [
    ...configList(config, "prod", "hosts"),
    ...configList(config, "prod", "databases"),
    ...detectedHosts(runtime, root, deployFiles),
  ];
  const declaredDeploy = configAt(config, "prod", "deploy");
  const existing = deployFiles.find((file) => runtime.stat(toAbsolutePath(join(root, file))) !== undefined);
  return {
    hosts: new Set(hosts.map(hostKey).filter((host) => host !== "")),
    kubeContexts: configList(config, "prod", "kube_contexts"),
    dockerContexts: configList(config, "prod", "docker_contexts"),
    deployPath: typeof declaredDeploy === "string" ? declaredDeploy : existing,
  };
};

export const isProdContext = (name: string, declared: readonly string[]): boolean =>
  declared.includes(name) || /(?:^|[-_.:/])(?:prod|production)(?:$|[-_.:/])/i.test(name);
