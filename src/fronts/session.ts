import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { HookDecision, HookHandler } from "../hooks/handlers.js";
import { gitWorktrees } from "../wt/git-list.js";
import { type Front, readFronts, SESSION_ID, updateFronts, withFront } from "./state.js";

const ALLOW: HookDecision = { kind: "allow" };
const READ_ONLY = { GIT_OPTIONAL_LOCKS: "0" } as const;

const topLevel = (runtime: Runtime, cwd: AbsolutePath): AbsolutePath | undefined => {
  const result = runtime.gitWith(["rev-parse", "--show-toplevel"], cwd, { env: READ_ONLY });
  const path = result.ok ? result.stdout.trim() : "";
  return path === "" ? undefined : toAbsolutePath(path);
};

const unclaimed = (runtime: Runtime, fronts: readonly Front[], top: AbsolutePath): Front | undefined => {
  const here = runtime.realpath(top);
  return fronts.find(
    (front) =>
      front.sessionId === undefined && front.path !== null && runtime.realpath(toAbsolutePath(front.path)) === here,
  );
};

export const recordFrontSession = (runtime: Runtime, cwd: AbsolutePath, session: string): string | undefined => {
  if (!SESSION_ID.test(session)) return undefined;
  const trees = gitWorktrees(runtime, cwd) ?? [];
  const main = trees.find((tree) => tree.main);
  if (main === undefined || trees.length < 2) return undefined;
  const top = topLevel(runtime, cwd);
  const root = toAbsolutePath(main.path);
  if (top === undefined || runtime.realpath(top) === runtime.realpath(root)) return undefined;
  const state = readFronts(runtime, root);
  const front = state.ok ? unclaimed(runtime, state.value.fronts, top) : undefined;
  if (front === undefined) return undefined;
  const written = updateFronts(runtime, root, (current) => {
    const still = unclaimed(runtime, current.fronts, top);
    return accept({
      state: still === undefined ? current : withFront(current, still.id, (item) => ({ ...item, sessionId: session })),
      result: still?.id,
    });
  });
  return written.ok ? written.value : undefined;
};

export const frontsSessionStart: HookHandler = (input) => {
  const session = input.payload.sessionId;
  const cwd = input.payload.cwd === undefined ? input.cwd : toAbsolutePath(input.payload.cwd, input.cwd);
  if (session !== undefined) recordFrontSession(input.runtime, cwd, session);
  return ALLOW;
};
