import { AUDIT_STATES } from "../audit/classify.js";
import { runAudit } from "../audit/run.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { maskText } from "../mask/mask.js";
import { fmPaths } from "../task/paths.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

const MAX_TEXT = 140;

export const auditCommand: CommandSpec = {
  path: ["audit"],
  summaryKey: "command.audit.summary",
  usage: "finitemonkey audit",
  status: "ready",
  run: (ctx): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const report = runAudit(ctx.runtime, fmPaths(repo.root), ctx.env);
    const items = report.items.map((item) => ({ ...item, text: maskText(item.text).slice(0, MAX_TEXT) }));
    const data = { ...report, items };
    const human = [
      ctx.t("audit.title", { count: items.length, source: report.source }),
      ...AUDIT_STATES.flatMap((state) => {
        const listed = items.filter((item) => item.state === state);
        return listed.length === 0
          ? []
          : [
              ctx.t(`audit.state.${state}`, { count: listed.length }),
              ...listed.map((item) => `  - ${item.text}${item.where === undefined ? "" : ` (${item.where})`}`),
            ];
      }),
      ...(report.incidents.length === 0 ? [] : [ctx.t("audit.incidents", { list: report.incidents.join(", ") })]),
    ];
    const open = items.filter((item) => item.state === "lost" || item.state === "contradicted").length;
    if (open === 0) return Promise.resolve(success(data, human));
    return Promise.resolve(
      failureFrom(
        ctx.t,
        {
          code: "audit_findings",
          messageKey: "audit.error.open",
          params: { count: open },
          fix: "write each lost item into the master plan or a report, and fix each contradiction",
          exitCode: ExitCode.CheckFailed,
          data,
        },
        human,
      ),
    );
  },
};
