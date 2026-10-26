export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export const parseSemver = (raw: string): SemVer | undefined => {
  const match = SEMVER.exec(raw.trim());
  if (match === null) return undefined;
  const prerelease = (match[4] ?? "")
    .split(".")
    .filter((part) => part !== "")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
};

const sign = (value: number): -1 | 0 | 1 => (value < 0 ? -1 : value > 0 ? 1 : 0);

const comparePart = (a: string | number, b: string | number): -1 | 0 | 1 => {
  if (typeof a === "number" && typeof b === "number") return sign(a - b);
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a === b ? 0 : a < b ? -1 : 1;
};

const comparePrerelease = (a: SemVer["prerelease"], b: SemVer["prerelease"]): -1 | 0 | 1 => {
  if (a.length === 0 || b.length === 0) return sign(b.length - a.length);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const order = comparePart(left, right);
    if (order !== 0) return order;
  }
  return 0;
};

export const compareSemver = (a: SemVer, b: SemVer): -1 | 0 | 1 =>
  sign(a.major - b.major) ||
  sign(a.minor - b.minor) ||
  sign(a.patch - b.patch) ||
  comparePrerelease(a.prerelease, b.prerelease);
