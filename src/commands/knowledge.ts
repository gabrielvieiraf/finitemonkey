import { usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { knowledgeMap, optedIn, writeMapCache } from "../knowledge/who-knows.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const KNOWLEDGE_MAP_SCHEMA = "finitemonkey/knowledge-map@1";

const USAGE = "finitemonkey knowledge map";

export const knowledgeMapCommand: CommandSpec = {
  path: ["knowledge", "map"],
  summaryKey: "command.knowledge_map.summary",
  usage: USAGE,
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      if (!optedIn(ctx.runtime, paths))
        return failureFrom(ctx.t, usageProblem("invalid_arguments", "knowledge.map.opt_in", USAGE));
      const areas = knowledgeMap(ctx.runtime, paths);
      writeMapCache(ctx.runtime, paths, areas);
      return success(
        { schema: KNOWLEDGE_MAP_SCHEMA, areas },
        areas.map((area) =>
          ctx.t(`knowledge.map.${area.holder}`, {
            area: area.area,
            person: area.personCommits,
            agent: area.agentCommits,
            claims: area.checkedClaims,
          }),
        ),
      );
    }),
};
