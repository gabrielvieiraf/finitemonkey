import type { Note } from "../../evidence/types.js";
import type { AcceptanceCheck, GitRequirement } from "../../task/types.js";
import { aheadOfUpstream, dirtyPaths } from "../git.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

const requirement = (want: GitRequirement, ctx: GateContext): Note | undefined => {
  if (want === "committed") {
    const dirty = dirtyPaths(ctx.git);
    return dirty.length === 0 ? undefined : note("gate.git.uncommitted", { count: dirty.length, file: dirty[0] ?? "" });
  }
  if (want === "pushed") {
    const ahead = aheadOfUpstream(ctx.git);
    if (ahead === undefined) return note("gate.git.no_upstream");
    return ahead === 0 ? undefined : note("gate.git.unpushed", { count: ahead });
  }
  const pr = ctx.pr();
  return pr.kind === "found" && pr.pr.state === "OPEN" ? undefined : note("gate.git.no_pr");
};

export const gitCheck = (check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const wants = check.require ?? ["committed"];
  const missing = wants.flatMap((want) => {
    const problem = requirement(want, ctx);
    return problem === undefined ? [] : [problem];
  });
  return missing.length > 0 ? failed(missing) : passed([note("gate.git.ok", { require: wants.join(", ") })]);
};
