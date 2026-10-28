import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";
import { MASTER_FILE, PREVIOUS_PREFIX } from "../plan/reports.js";
import { scanText } from "../secrets/engine.js";
import { recordIncident } from "../secrets/incidents.js";
import { CREDENTIAL_RULES } from "../secrets/rules/catalog.js";
import type { FmPaths } from "../task/paths.js";
import { type AuditItem, classify, type PlanDoc } from "./classify.js";
import { readPrompts } from "./log.js";
import { transcriptRequests } from "./transcripts.js";

export const AUDIT_SCHEMA = "finitemonkey/audit@1";
const ACTOR = "finitemonkey audit";

export interface AuditReport {
  readonly schema: typeof AUDIT_SCHEMA;
  readonly source: "prompts" | "transcripts";
  readonly items: readonly AuditItem[];
  readonly incidents: readonly string[];
}

const planDocs = (runtime: Runtime, paths: FmPaths): readonly PlanDoc[] =>
  planFiles(runtime, paths.root)
    .filter((name) => name.endsWith(".md") && !name.startsWith(PREVIOUS_PREFIX))
    .flatMap((name) => {
      const text = runtime.readText(planPath(paths.root, name));
      return text.ok ? [{ file: `${PLAN_DIR}/${name}`, text: text.value, master: name === MASTER_FILE }] : [];
    })
    .sort((a, b) => Number(b.master) - Number(a.master));

const pastedCredentials = (runtime: Runtime, paths: FmPaths, env: Env): readonly string[] =>
  transcriptRequests(runtime, paths, env).flatMap((request) =>
    scanText(request.text, { rules: CREDENTIAL_RULES }).flatMap((finding) => {
      const saved = recordIncident(
        runtime,
        paths.root,
        {
          rule: finding.ruleId,
          fingerprint: finding.fingerprint,
          where: `session ${request.session}:${String(finding.line)}`,
          source: "history",
          state: "exposicao-local",
        },
        ACTOR,
      );
      return saved.ok ? [saved.value.id] : [];
    }),
  );

export const runAudit = (runtime: Runtime, paths: FmPaths, env: Env): AuditReport => {
  const logged = readPrompts(runtime, paths);
  const requests = logged.length > 0 ? logged : transcriptRequests(runtime, paths, env);
  return {
    schema: AUDIT_SCHEMA,
    source: logged.length > 0 ? "prompts" : "transcripts",
    items: classify(requests, planDocs(runtime, paths)),
    incidents: [...new Set(pastedCredentials(runtime, paths, env))],
  };
};
