export interface LockPackage {
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly resolved: string | undefined;
  readonly integrity: string | undefined;
  readonly license: string | undefined;
  readonly dev: boolean;
  readonly optional: boolean;
  readonly link: boolean;
  readonly dependencies: readonly string[];
  readonly optionalDependencies: readonly string[];
}

export interface Lockfile {
  readonly packages: ReadonlyMap<string, LockPackage>;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

const text = (value: unknown, key: string): string | undefined => {
  const found = field(value, key);
  return typeof found === "string" ? found : undefined;
};

const flag = (value: unknown, key: string): boolean => field(value, key) === true;

const names = (value: unknown, key: string): string[] => {
  const found = field(value, key);
  return typeof found === "object" && found !== null ? Object.keys(found).sort() : [];
};

const lockPackage = (raw: unknown): LockPackage => ({
  name: text(raw, "name"),
  version: text(raw, "version"),
  resolved: text(raw, "resolved"),
  integrity: text(raw, "integrity"),
  license: text(raw, "license"),
  dev: flag(raw, "dev"),
  optional: flag(raw, "optional") || flag(raw, "devOptional") || flag(raw, "peer"),
  link: flag(raw, "link"),
  dependencies: [...names(raw, "dependencies"), ...names(raw, "devDependencies")],
  optionalDependencies: [...names(raw, "optionalDependencies"), ...names(raw, "peerDependencies")],
});

export const parseLockfile = (source: string): Lockfile => {
  const parsed: unknown = JSON.parse(source);
  const version = field(parsed, "lockfileVersion");
  if (version !== 2 && version !== 3) throw new Error("package-lock.json must have lockfileVersion 2 or 3");
  const packages = field(parsed, "packages");
  if (typeof packages !== "object" || packages === null) throw new Error("package-lock.json has no packages map");
  return { packages: new Map(Object.entries(packages).map(([key, raw]) => [key, lockPackage(raw)])) };
};

export const packageName = (key: string, entry: LockPackage): string =>
  entry.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);

export const resolveDependency = (lock: Lockfile, from: string, name: string): string | undefined => {
  let base = from;
  for (;;) {
    const candidate = `${base === "" ? "" : `${base}/`}node_modules/${name}`;
    if (lock.packages.has(candidate)) return candidate;
    if (base === "") return undefined;
    const cut = base.lastIndexOf("/node_modules/");
    base = cut === -1 ? "" : base.slice(0, cut);
  }
};
