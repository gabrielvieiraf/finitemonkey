import { posix } from "node:path";

import { toPosixPath } from "../core/posix-path.js";

const WSL_MOUNT = /^\/mnt\/([a-zA-Z])(\/|$)/;
const DRIVE = /^([a-zA-Z]):(\/|$)/;

export const pathKey = (path: string): string => {
  const posixPath = toPosixPath(path).replace(
    WSL_MOUNT,
    (_match, letter: string, slash: string) => `${letter}:${slash || "/"}`,
  );
  const drive = DRIVE.exec(posixPath);
  const normalized = posix.normalize(drive === null ? posixPath : posixPath.slice(2) || "/");
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  return drive === null ? trimmed : `${(drive[1] ?? "").toLowerCase()}:${trimmed}`.toLowerCase();
};

export const isWithin = (child: string, parent: string): boolean => {
  const childKey = pathKey(child);
  const parentKey = pathKey(parent);
  if (childKey === parentKey) return true;
  const base = parentKey.endsWith("/") ? parentKey : `${parentKey}/`;
  return childKey.startsWith(base);
};

export const isRootLike = (path: string, home: string | undefined): boolean => {
  const key = pathKey(path);
  if (key === "/" || /^[a-z]:\/?$/.test(key) || /^\/mnt(?:\/[a-z])?\/?$/.test(key)) return true;
  return home !== undefined && home !== "" && key === pathKey(home);
};

export const resolveFrom = (base: string, ...parts: readonly (string | undefined)[]): string =>
  parts.reduce<string>((current, part) => {
    if (part === undefined || part === "") return current;
    const next = toPosixPath(part);
    if (next.startsWith("/") || DRIVE.test(next)) return next;
    return posix.join(toPosixPath(current), next);
  }, toPosixPath(base));
