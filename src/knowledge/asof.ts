import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import type { FmPaths } from "../task/paths.js";
import { anchorState } from "./anchor.js";
import { readClaims } from "./claims.js";

export interface AsOfRow {
  readonly id: string;
  readonly text: string;
  readonly status: "valid" | "stale";
  readonly known: boolean;
}

export const asOf = (
  runtime: Pick<Runtime, "readText" | "exec">,
  paths: FmPaths,
  commit: string,
): readonly AsOfRow[] => {
  const git = gitAt(runtime, paths.root);
  const when = Date.parse(git.out(["show", "-s", "--format=%cI", commit])?.trim() ?? "");
  return readClaims(runtime, paths).map((claim) => {
    const same = claim.anchors.every(
      (anchor) => anchorState(anchor, git.out(["show", `${commit}:${anchor.path}`])) === "same",
    );
    return {
      id: claim.id,
      text: claim.text,
      status: same ? "valid" : "stale",
      known: Number.isFinite(when) && Date.parse(claim.recordedAt) <= when,
    };
  });
};
