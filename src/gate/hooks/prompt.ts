import { parseConcept } from "../../conceitos/concepts.js";
import { recordPrediction } from "../../conceitos/predict.js";
import { nowMs } from "../../core/clock.js";
import { logEvent } from "../../evidence/log.js";
import { type Approval, expiryFrom, type Grant, saveRelease } from "../../guards/release/grants.js";
import { comesFromPerson, type Marker, parseMarkers, type PredictMarker } from "../../guards/release/markers.js";
import { textField } from "../../hooks/fields.js";
import type { HookHandler, HookInput } from "../../hooks/handlers.js";
import { recordDismissal } from "../../policy/budget.js";
import { KNOWN_GUARDS } from "../../policy/policy.js";
import { IMPLICIT_ID } from "../../task/implicit.js";
import type { FmPaths } from "../../task/paths.js";
import { readState } from "../../task/state.js";
import { trustContract } from "../trust-contract.js";
import { allowWith, human, projectPaths } from "./common.js";
import { readCounter, saveCounter } from "./counter.js";
import { readGateStatus } from "./status.js";

export const RELEASABLE = new Set(["tests", "bypass", "self", "config", "budget", "claims", "predict"]);

const trustAndApprove = (input: HookInput, paths: FmPaths, task: string): boolean =>
  trustContract(input.runtime, paths, task, `person@${input.runtime.now()}`).kind === "trusted";

const predicted = (input: HookInput, paths: FmPaths, marker: PredictMarker): string => {
  const concept = parseConcept(marker.concept);
  const recorded = concept === undefined ? undefined : recordPrediction(input.runtime, paths, concept, marker.output);
  return recorded === undefined
    ? input.t("predict.not_recorded", { concept: marker.concept })
    : input.t("predict.recorded", { concept: recorded.concept, output: recorded.output });
};

const apply = (input: HookInput, paths: FmPaths, markers: readonly Marker[]): readonly string[] => {
  const { runtime, t } = input;
  const now = nowMs(runtime);
  const at = new Date(now).toISOString();
  const sessionId = input.payload.sessionId;
  const grants: Grant[] = [];
  const approvals: Approval[] = [];
  const said: string[] = [];
  const active = readState(runtime, paths).active ?? IMPLICIT_ID;
  const status = readGateStatus(runtime, paths);
  for (const marker of markers) {
    if (marker.type === "allow" && RELEASABLE.has(marker.guard)) {
      grants.push({
        guard: marker.guard,
        reason: marker.reason,
        grantedAt: at,
        expiresAt: expiryFrom(now),
        ...(sessionId === undefined ? {} : { sessionId }),
      });
      said.push(t("gate.release.allowed", { guard: marker.guard, until: expiryFrom(now) }));
      if (KNOWN_GUARDS.includes(marker.guard)) recordDismissal(runtime, paths, marker.guard);
    } else if (marker.type === "allow") said.push(t("gate.release.unknown_guard", { guard: marker.guard }));
    else if (marker.type === "approve") {
      approvals.push({
        task: marker.task ?? active,
        check: marker.check,
        reason: marker.reason,
        at,
        ...(status?.tree === undefined || status.task !== (marker.task ?? active) ? {} : { treeHash: status.tree }),
      });
      said.push(t("gate.release.approved", { task: marker.task ?? active, check: marker.check }));
    } else if (marker.type === "predict") said.push(predicted(input, paths, marker));
    else
      said.push(
        t(trustAndApprove(input, paths, marker.task) ? "gate.release.trusted" : "gate.release.trust_failed", {
          task: marker.task,
        }),
      );
    logEvent(runtime, paths, `person.${marker.type}`, { ...marker, sessionId: sessionId ?? null });
  }
  if (grants.length + approvals.length > 0) saveRelease(runtime, paths, now, { grants, approvals });
  return said;
};

export const promptRelease: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  if (!comesFromPerson(prompt)) return { kind: "allow" };
  const paths = projectPaths(input);
  if (paths === undefined) return { kind: "allow" };
  if (readCounter(input.runtime, paths) !== undefined) saveCounter(input.runtime, paths, undefined);
  const markers = parseMarkers(prompt);
  if (markers.length === 0) return { kind: "allow" };
  return allowWith({ systemMessage: human(apply(input, paths, markers).join(" ")) });
};
