import { createHash } from "node:crypto";

import { type Lockfile, type LockPackage, packageName, resolveDependency } from "./sbom-lock.js";

export const SPEC_VERSION = "1.5";

export type Scope = "required" | "optional" | "excluded";

export interface Hash {
  readonly alg: string;
  readonly content: string;
}

export interface Component {
  readonly type: "library" | "application";
  readonly "bom-ref": string;
  readonly group?: string;
  readonly name: string;
  readonly version: string;
  readonly purl: string;
  readonly scope?: Scope;
  readonly hashes?: readonly Hash[];
  readonly licenses?: readonly ({ readonly expression: string } | { readonly license: { readonly name: string } })[];
  readonly externalReferences?: readonly { readonly type: "distribution"; readonly url: string }[];
}

export interface Dependency {
  readonly ref: string;
  readonly dependsOn: readonly string[];
}

export interface Bom {
  readonly $schema: string;
  readonly bomFormat: "CycloneDX";
  readonly specVersion: string;
  readonly serialNumber: string;
  readonly version: number;
  readonly metadata: {
    readonly timestamp: string;
    readonly tools: { readonly components: readonly { type: "application"; name: string; version: string }[] };
    readonly component: Component;
  };
  readonly components: readonly Component[];
  readonly dependencies: readonly Dependency[];
}

export interface SbomResult {
  readonly bom: Bom | undefined;
  readonly problems: readonly string[];
}

const ALGORITHMS: Readonly<Record<string, string>> = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};

const SCOPE_RANK: Readonly<Record<Scope, number>> = { required: 0, optional: 1, excluded: 2 };
const EXPRESSION = /^\(?[A-Za-z0-9.+-]+(?:\s+(?:AND|OR|WITH)\s+\(?[A-Za-z0-9.+-]+\)?)*\)?$/;

export const purl = (name: string, version: string): string => {
  const path = name.split("/").map(encodeURIComponent).join("/");
  return `pkg:npm/${path}@${encodeURIComponent(version)}`;
};

export const hashes = (integrity: string | undefined): Hash[] =>
  (integrity ?? "").split(/\s+/).flatMap((item) => {
    const cut = item.indexOf("-");
    const alg = ALGORITHMS[item.slice(0, cut)];
    if (cut === -1 || alg === undefined) return [];
    return [{ alg, content: Buffer.from(item.slice(cut + 1), "base64").toString("hex") }];
  });

export const licenses = (license: string | undefined): NonNullable<Component["licenses"]> => {
  if (license === undefined || license.trim() === "") return [];
  return EXPRESSION.test(license) ? [{ expression: license }] : [{ license: { name: license } }];
};

const scopeOf = (entry: LockPackage): Scope => (entry.dev ? "excluded" : entry.optional ? "optional" : "required");

const component = (name: string, entry: LockPackage, version: string, type: Component["type"]): Component => {
  const ref = purl(name, version);
  const slash = name.indexOf("/");
  const found = hashes(entry.integrity);
  const licensed = licenses(entry.license);
  return {
    type,
    "bom-ref": ref,
    ...(name.startsWith("@") && slash !== -1 ? { group: name.slice(0, slash), name: name.slice(slash + 1) } : { name }),
    version,
    purl: ref,
    ...(type === "library" ? { scope: scopeOf(entry) } : {}),
    ...(found.length > 0 ? { hashes: found } : {}),
    ...(licensed.length > 0 ? { licenses: licensed } : {}),
    ...(entry.resolved?.startsWith("https://") === true
      ? { externalReferences: [{ type: "distribution" as const, url: entry.resolved }] }
      : {}),
  };
};

const mergeScope = (a: Component, b: Component): Component =>
  SCOPE_RANK[b.scope ?? "required"] < SCOPE_RANK[a.scope ?? "required"] ? { ...a, scope: b.scope ?? "required" } : a;

export const serialNumber = (seed: string): string => {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

interface Collected {
  readonly components: Map<string, Component>;
  readonly edges: Map<string, Set<string>>;
  readonly keyRef: Map<string, string>;
  readonly problems: string[];
}

const collect = (lock: Lockfile): Collected => {
  const state: Collected = { components: new Map(), edges: new Map(), keyRef: new Map(), problems: [] };
  for (const [key, entry] of lock.packages) {
    if (key === "" || entry.link) continue;
    const name = packageName(key, entry);
    if (entry.version === undefined) {
      state.problems.push(`${key} has no version`);
      continue;
    }
    const next = component(name, entry, entry.version, "library");
    const existing = state.components.get(next.purl);
    state.components.set(next.purl, existing === undefined ? next : mergeScope(existing, next));
    state.keyRef.set(key, next.purl);
  }
  return state;
};

const link = (lock: Lockfile, state: Collected, key: string, ref: string, entry: LockPackage): void => {
  const targets = state.edges.get(ref) ?? new Set<string>();
  const wanted = [
    ...entry.dependencies.map((name) => ({ name, required: true })),
    ...entry.optionalDependencies.map((name) => ({ name, required: false })),
  ];
  for (const { name, required } of wanted) {
    const target = resolveDependency(lock, key, name);
    const targetRef = target === undefined ? undefined : state.keyRef.get(target);
    if (targetRef !== undefined) targets.add(targetRef);
    else if (required)
      state.problems.push(`${key === "" ? "the root package" : key} needs ${name}, missing from the lockfile`);
  }
  state.edges.set(ref, targets);
};

export const buildSbom = (lock: Lockfile, timestamp: string, toolVersion: string): SbomResult => {
  const root = lock.packages.get("");
  if (root?.name === undefined || root.version === undefined) {
    return { bom: undefined, problems: ["the lockfile root has no name or version"] };
  }
  const state = collect(lock);
  const rootComponent = component(root.name, root, root.version, "application");
  for (const [key, entry] of lock.packages) {
    const ref = key === "" ? rootComponent["bom-ref"] : state.keyRef.get(key);
    if (ref !== undefined) link(lock, state, key, ref, entry);
  }
  if (state.problems.length > 0) return { bom: undefined, problems: state.problems };
  const components = [...state.components.values()].sort((a, b) => a.purl.localeCompare(b.purl));
  const dependencies = [...state.edges.entries()]
    .map(([ref, targets]) => ({ ref, dependsOn: [...targets].sort() }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
  const body = { components, dependencies };
  return {
    bom: {
      $schema: `http://cyclonedx.org/schema/bom-${SPEC_VERSION}.schema.json`,
      bomFormat: "CycloneDX",
      specVersion: SPEC_VERSION,
      serialNumber: serialNumber(`${timestamp}\n${JSON.stringify(body)}`),
      version: 1,
      metadata: {
        timestamp,
        tools: { components: [{ type: "application", name: "finitemonkey-sbom", version: toolVersion }] },
        component: rootComponent,
      },
      ...body,
    },
    problems: [],
  };
};
