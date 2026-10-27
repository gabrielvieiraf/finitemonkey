import type { AbsolutePath } from "../core/brand.js";
import { stringifyYaml } from "../core/yaml/write.js";
import {
  type Cloud,
  type CredRisk,
  credRisk,
  type CredType,
  credType,
  isCredentialName,
  STATIC_CLOUD,
} from "./classify.js";
import { envFiles, environmentOf, envNames, isEnvTemplate } from "./env-files.js";
import type { CredsRuntime } from "./files.js";
import { type EnvRead, envReads } from "./reads.js";

export const CREDS_FILE = ".finitemonkey/creds.yml";

export interface Credential {
  readonly name: string;
  readonly type: CredType;
  readonly risk: CredRisk;
  readonly cloud?: Cloud;
  readonly services: readonly string[];
  readonly shared: boolean;
  readonly environments: readonly string[];
  readonly readAt: readonly string[];
}

const SERVICE_ROOTS = new Set(["apps", "services", "packages", "functions", "workers", "cmd"]);

export const serviceOf = (read: EnvRead): string => {
  if (read.kind === "workflow") return "ci";
  const parts = read.file.split("/");
  const [first = "", second] = parts;
  if (parts.length > 2 && SERVICE_ROOTS.has(first) && second !== undefined) return `${first}/${second}`;
  return ".";
};

const environments = (runtime: CredsRuntime, root: AbsolutePath): ReadonlyMap<string, readonly string[]> => {
  const map = new Map<string, Set<string>>();
  for (const file of envFiles(runtime, root).filter((item) => !isEnvTemplate(item))) {
    for (const name of envNames(runtime, root, file)) {
      const set = map.get(name) ?? new Set<string>();
      set.add(environmentOf(file));
      map.set(name, set);
    }
  }
  return new Map([...map.entries()].map(([name, set]) => [name, [...set].sort()]));
};

export const credentialInventory = (runtime: CredsRuntime, root: AbsolutePath): readonly Credential[] => {
  const reads = envReads(runtime, root).filter((read) => read.kind === "workflow" || isCredentialName(read.name));
  const envs = environments(runtime, root);
  const names = [...new Set(reads.map((read) => read.name))].sort();
  return names.map((name) => {
    const mine = reads.filter((read) => read.name === name);
    const services = [...new Set(mine.map(serviceOf))].sort();
    const codeServices = services.filter((service) => service !== "ci");
    const inCi = services.includes("ci");
    const cloud = STATIC_CLOUD[name];
    return {
      name,
      type: credType(name),
      risk: credRisk(name, codeServices.length),
      ...(cloud === undefined ? {} : { cloud }),
      services,
      shared: codeServices.length > 1,
      environments: [...new Set([...(envs.get(name) ?? []), ...(inCi ? ["ci"] : [])])].sort(),
      readAt: mine.map((read) => `${read.file}:${String(read.line)}`),
    };
  });
};

export const inventoryYaml = (credentials: readonly Credential[]): string =>
  `# finitemonkey creds: names and places only, never values\n${stringifyYaml({
    schemaVersion: 1,
    credentials: credentials.map((credential) => ({
      name: credential.name,
      type: credential.type,
      risk: credential.risk,
      ...(credential.cloud === undefined ? {} : { cloud: credential.cloud }),
      shared: credential.shared,
      services: [...credential.services],
      environments: [...credential.environments],
      readAt: [...credential.readAt],
    })),
  })}`;
