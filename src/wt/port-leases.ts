import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { HOME_DATA_DIR } from "../core/data-dir.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import type { PortRange, WorktreeEntry } from "./entry.js";
import { allocatePorts } from "./ports.js";

export const PORT_LEASE_SCHEMA = "finitemonkey/port-lease@1";

interface Lease extends PortRange {
  readonly path: string;
}

export const portsDir = (runtime: Pick<Runtime, "homeDir">): AbsolutePath =>
  toAbsolutePath(join(runtime.homeDir(), HOME_DATA_DIR, "ports"));

const leaseOf = (text: string): Lease | undefined => {
  const parsed = parseJsonObject(text);
  if (!parsed.ok || !isRecord(parsed.value)) return undefined;
  const { from, to, path } = parsed.value;
  return typeof from === "number" && typeof to === "number" && typeof path === "string"
    ? { from, to, path }
    : undefined;
};

export const machineLeases = (runtime: Runtime, except: string): readonly Lease[] => {
  const dir = portsDir(runtime);
  const names = runtime.listDir(dir);
  return (names.ok ? names.value : []).flatMap((name) => {
    if (!name.endsWith(".json")) return [];
    const text = runtime.readText(toAbsolutePath(join(dir, name)));
    const lease = text.ok ? leaseOf(text.value) : undefined;
    if (lease === undefined || lease.path === except) return [];
    return runtime.stat(toAbsolutePath(lease.path)) === undefined ? [] : [lease];
  });
};

const LOCK = { staleMs: 15_000, owner: "ports" } as const;

export const leasePorts = (
  runtime: Runtime,
  worktree: AbsolutePath,
  entries: readonly WorktreeEntry[],
  base: number,
): PortRange | undefined => {
  const dir = portsDir(runtime);
  runtime.mkdir(dir);
  const lock = runtime.lock(toAbsolutePath(join(dir, ".lock")), LOCK);
  try {
    const path = toPosixPath(worktree);
    const range = allocatePorts(entries, base, machineLeases(runtime, path));
    if (range === undefined) return undefined;
    const lease = { schema: PORT_LEASE_SCHEMA, ...range, path, at: runtime.now() };
    runtime.writeAtomic(toAbsolutePath(join(dir, `${String(range.from)}.json`)), `${JSON.stringify(lease)}\n`);
    return range;
  } finally {
    if (lock.ok) lock.value();
  }
};
