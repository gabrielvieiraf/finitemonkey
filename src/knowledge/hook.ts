import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { contextOutput, projectPaths, sessionCwd } from "../gate/hooks/common.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { tokenEstimate } from "../instructions/types.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { diskReader } from "./anchor.js";
import { readDemoted, recordInjected } from "./arms.js";
import { appendClaimEvent, KNOWLEDGE_CLAIMS_FEATURE, lastOf, readClaims } from "./claims.js";
import { withQuarantine } from "./quarantine.js";
import { withRetractions } from "./retraction.js";
import { injectable } from "./service.js";
import { type ClaimView, evaluateClaim } from "./status.js";

export const MAX_INJECTED = 20;
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const where = (view: ClaimView): string =>
  view.anchors
    .map((item) => (item.anchor.symbol === undefined ? item.anchor.path : `${item.anchor.path}#${item.anchor.symbol}`))
    .join(", ");

export const claimLine = (t: Translate, view: ClaimView): string =>
  t(view.claim.kind === "check" ? "knowledge.claims.context.line" : "knowledge.claims.context.prose", {
    id: view.claim.id,
    text: view.claim.text,
    where: where(view),
  });

const allow = { kind: "allow" } as const;

export const claimsOnSessionStart: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined) return allow;
  const claims = readClaims(input.runtime, paths);
  if (claims.length === 0) return allow;
  const read = diskReader(input.runtime, paths.root);
  const evaluated = claims.map((claim) => evaluateClaim(claim, { read, candidates: () => [] }));
  const views = injectable(
    withQuarantine(input.runtime, paths, withRetractions(input.runtime, paths, evaluated), false),
  ).slice(0, MAX_INJECTED);
  if (views.length === 0) return allow;
  if (readDemoted(input.runtime, paths).has(KNOWLEDGE_CLAIMS_FEATURE)) {
    recordFeatureShadow(input.runtime, paths, KNOWLEDGE_CLAIMS_FEATURE, { demoted: 1 });
    return allow;
  }
  if (featureMode(input.runtime, paths, KNOWLEDGE_CLAIMS_FEATURE) !== "active") {
    recordFeatureShadow(input.runtime, paths, KNOWLEDGE_CLAIMS_FEATURE, { injected: views.length });
    return allow;
  }
  const text = [input.t("knowledge.claims.context.title"), ...views.map((view) => claimLine(input.t, view))].join("\n");
  recordInjected(input.runtime, paths, "knowledge-claims", tokenEstimate(text));
  return { kind: "allow", output: contextOutput("SessionStart", text) };
};

export const claimsAfterEdit: HookHandler = (input) => {
  const raw = input.payload.raw;
  const target = textField(toolInput(raw), "file_path", "notebook_path");
  const paths = projectPaths(input);
  if (paths === undefined || target === undefined || !EDIT_TOOLS.has(toolName(raw))) return allow;
  const file = toPosixPath(relative(paths.root, toAbsolutePath(target, sessionCwd(input))));
  const touched = readClaims(input.runtime, paths).filter((claim) =>
    claim.anchors.some((anchor) => anchor.path === file),
  );
  const read = diskReader(input.runtime, paths.root);
  for (const claim of touched) {
    const view = evaluateClaim(claim, { read, candidates: () => [] });
    const last = lastOf(claim, ["stale", "renew", "add"]);
    if (view.status !== "stale" || last?.event === "stale") continue;
    appendClaimEvent(input.runtime, paths, {
      event: "stale",
      id: claim.id,
      recordedAt: input.runtime.now(),
      ...(view.reason === undefined ? {} : { reason: view.reason }),
    });
  }
  return allow;
};

export const KNOWLEDGE_CLAIMS_HANDLERS: HookHandlers = {
  SessionStart: [claimsOnSessionStart],
  PostToolUse: [claimsAfterEdit],
};
