import { isRecord } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import type { FmPaths } from "../../task/paths.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";

export const GRANT_MINUTES = 30;

export interface Grant {
  readonly guard: string;
  readonly reason: string;
  readonly sessionId?: string;
  readonly grantedAt: string;
  readonly expiresAt: string;
}

export interface AcceptedFile {
  readonly path: string;
  readonly hash: string;
}

export interface Approval {
  readonly task: string;
  readonly check: string;
  readonly reason: string;
  readonly at: string;
  readonly treeHash?: string;
  readonly accepted?: readonly AcceptedFile[];
}

type Store = Pick<Runtime, "readText" | "writeText">;

const text = (record: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const toGrant = (value: unknown): Grant | undefined => {
  if (!isRecord(value)) return undefined;
  const guard = text(value, "guard");
  const reason = text(value, "reason");
  const grantedAt = text(value, "grantedAt");
  const expiresAt = text(value, "expiresAt");
  const sessionId = text(value, "sessionId");
  if (guard === undefined || reason === undefined || grantedAt === undefined || expiresAt === undefined)
    return undefined;
  return { guard, reason, grantedAt, expiresAt, ...(sessionId === undefined ? {} : { sessionId }) };
};

const toAccepted = (value: unknown): readonly AcceptedFile[] | undefined =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        if (!isRecord(item)) return [];
        const path = text(item, "path");
        const hash = text(item, "hash");
        return path === undefined || hash === undefined ? [] : [{ path, hash }];
      })
    : undefined;

const toApproval = (value: unknown): Approval | undefined => {
  if (!isRecord(value)) return undefined;
  const task = text(value, "task");
  const check = text(value, "check");
  const at = text(value, "at");
  const treeHash = text(value, "treeHash");
  const accepted = toAccepted(value["accepted"]);
  if (task === undefined || check === undefined || at === undefined) return undefined;
  return {
    task,
    check,
    at,
    reason: text(value, "reason") ?? "",
    ...(treeHash === undefined ? {} : { treeHash }),
    ...(accepted === undefined ? {} : { accepted }),
  };
};

const list = <T>(raw: unknown, map: (value: unknown) => T | undefined): readonly T[] =>
  Array.isArray(raw)
    ? raw.flatMap((item: unknown) => {
        const value = map(item);
        return value === undefined ? [] : [value];
      })
    : [];

export const readGrants = (store: Pick<Runtime, "readText">, paths: FmPaths): readonly Grant[] =>
  list(readJsonFile(store, paths.grants)?.["grants"], toGrant);

export const readApprovals = (store: Pick<Runtime, "readText">, paths: FmPaths): readonly Approval[] =>
  list(readJsonFile(store, paths.grants)?.["approvals"], toApproval);

export const isLive = (grant: Grant, now: number, sessionId: string | undefined): boolean =>
  Date.parse(grant.expiresAt) > now &&
  (grant.sessionId === undefined || sessionId === undefined || grant.sessionId === sessionId);

export const activeGrant = (
  store: Pick<Runtime, "readText">,
  paths: FmPaths,
  guard: string,
  now: number,
  sessionId: string | undefined,
): Grant | undefined =>
  readGrants(store, paths).findLast((grant) => grant.guard === guard && isLive(grant, now, sessionId));

const approvalJson = (item: Approval) => ({
  ...item,
  ...(item.accepted === undefined ? {} : { accepted: item.accepted.map((file) => ({ ...file })) }),
});

export const saveRelease = (
  store: Store,
  paths: FmPaths,
  now: number,
  added: { readonly grants: readonly Grant[]; readonly approvals: readonly Approval[] },
): boolean => {
  const grants = [...readGrants(store, paths).filter((grant) => Date.parse(grant.expiresAt) > now), ...added.grants];
  const approvals = [...readApprovals(store, paths), ...added.approvals].map(approvalJson);
  return writeJsonFile(store, paths.grants, { grants: [...grants], approvals }).ok;
};

export const expiryFrom = (now: number): string => new Date(now + GRANT_MINUTES * 60_000).toISOString();

const sameApproval = (left: Approval, right: Approval): boolean =>
  left.task === right.task && left.check === right.check && left.at === right.at;

const rewriteApprovals = (store: Store, paths: FmPaths, change: (item: Approval) => Approval): boolean =>
  writeJsonFile(store, paths.grants, {
    grants: readGrants(store, paths).map((grant) => ({ ...grant })),
    approvals: readApprovals(store, paths).map(change).map(approvalJson),
  }).ok;

export const bindApproval = (store: Store, paths: FmPaths, approval: Approval, treeHash: string): boolean =>
  rewriteApprovals(store, paths, (item) =>
    sameApproval(item, approval) && item.treeHash === undefined ? { ...item, treeHash } : item,
  );

export const bindAccepted = (
  store: Store,
  paths: FmPaths,
  approval: Approval,
  accepted: readonly AcceptedFile[],
): boolean =>
  rewriteApprovals(store, paths, (item) =>
    sameApproval(item, approval) && item.accepted === undefined ? { ...item, accepted } : item,
  );
