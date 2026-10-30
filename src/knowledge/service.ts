import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import type { FmPaths } from "../task/paths.js";
import { diskReader } from "./anchor.js";
import { type Claim, readClaims } from "./claims.js";
import { withQuarantine } from "./quarantine.js";
import { withRetractions } from "./retraction.js";
import { type ClaimView, evaluateClaim, memoCandidates } from "./status.js";

export type ClaimsRuntime = Pick<Runtime, "readText" | "exec" | "homeDir" | "listDir">;

export const trackedFiles = (runtime: Pick<Runtime, "exec">, paths: FmPaths): readonly string[] =>
  (gitAt(runtime, paths.root).out(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]) ?? "")
    .split("\0")
    .filter((file) => file !== "");

export const viewsOf = (
  runtime: ClaimsRuntime,
  paths: FmPaths,
  claims: readonly Claim[] = readClaims(runtime, paths),
): readonly ClaimView[] => {
  const options = {
    read: diskReader(runtime, paths.root),
    candidates: memoCandidates(() => trackedFiles(runtime, paths)),
  };
  return withQuarantine(
    runtime,
    paths,
    withRetractions(
      runtime,
      paths,
      claims.map((claim) => evaluateClaim(claim, options)),
    ),
  );
};

export const injectable = (views: readonly ClaimView[]): readonly ClaimView[] =>
  views.filter((view) => view.status === "valid");
