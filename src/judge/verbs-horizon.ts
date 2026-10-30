import { recordHorizon } from "../signals/blind-band.js";
import { claimIdOf, claimsIn } from "./claims.js";
import { appendNow, type JudgeDeps } from "./deps.js";
import {
  bandCriterion,
  bandDomain,
  criterionOf,
  helpView,
  horizonDomains,
  type HorizonProposer,
  latestHelps,
} from "./horizon.js";
import type { JudgeRequest } from "./request.js";
import { type JudgeResponse, response } from "./response.js";
import { entryId, readEntries } from "./store.js";
import type { HorizonEntry } from "./types.js";

type Request<V extends JudgeRequest["verb"]> = Extract<JudgeRequest, { verb: V }>;

export const addHelp = (deps: JudgeDeps, request: Request<"horizon">): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const id = entryId("h", request.task ?? "", request.text.toLowerCase());
  const dismissed = latestHelps(entries).find((help) => help.id === id && help.state === "dismissed");
  if (dismissed !== undefined)
    return response("horizon", { reason: "dismissed_in_task", horizon: [helpView(dismissed)] });
  const written = appendNow(deps, {
    type: "horizon",
    id,
    kind: request.kind,
    text: request.text,
    criterion: criterionOf(request.criterion, request.answer),
    answer: request.answer,
    domain: request.domain,
    state: "shown",
    task: request.task,
  });
  if (!written.ok || written.entry.type !== "horizon")
    return response("horizon", { reason: written.ok ? "invalid" : written.reason });
  return response("horizon", { entry: id, horizon: [helpView(written.entry)] });
};

const claimFrom = (deps: JudgeDeps, help: HorizonEntry): string | undefined => {
  if (help.criterion !== "source-span" || help.answer === undefined) return undefined;
  const [ref = "", ...rest] = help.answer.trim().split(/\s+/);
  const span = rest.join(" ").replace(/^["“]|["”]$/g, "");
  const text = span === "" ? `${help.text} ([source](${ref}))` : `"${span}" ([source](${ref}))`;
  const id = claimIdOf(text);
  if (!claimsIn(readEntries(deps.runtime, deps.paths)).some((claim) => claim.id === id))
    appendNow(deps, {
      type: "claim",
      id,
      text,
      kind: span === "" ? "prose" : "source-span",
      concepts: [],
      anchors: [],
      provenance: "horizon",
    });
  return id;
};

export const settleHelp = (
  deps: JudgeDeps,
  request: Request<"accept"> | Request<"dismiss">,
  verify: (claim: string) => JudgeResponse,
): JudgeResponse => {
  const entries = readEntries(deps.runtime, deps.paths);
  const help = latestHelps(entries).find((item) => item.id === request.help);
  if (help === undefined) return response(request.verb, { reason: "unknown_help" });
  const state = request.verb === "accept" ? "accepted" : "dismissed";
  const written = appendNow(deps, { ...help, at: deps.runtime.now(), state });
  if (!written.ok || written.entry.type !== "horizon") return response(request.verb, { reason: "write_failed" });
  if (state === "accepted")
    recordHorizon(deps.runtime, deps.paths, {
      source: "research",
      criterion: bandCriterion(help.criterion),
      domain: bandDomain(help.domain),
      ...(help.task === undefined ? {} : { task: help.task }),
    });
  const claim = state === "accepted" ? claimFrom(deps, help) : undefined;
  const verified = claim === undefined ? undefined : verify(claim).claim;
  return response(request.verb, {
    horizon: [helpView(written.entry)],
    horizonDomains: horizonDomains(readEntries(deps.runtime, deps.paths)),
    ...(verified === undefined ? {} : { claim: verified }),
  });
};

export const proposeHelps = (
  deps: JudgeDeps,
  subject: { readonly text: string; readonly domain: string; readonly task?: string },
  proposer: HorizonProposer | undefined,
): JudgeResponse => {
  const proposed = proposer?.(subject.text) ?? [];
  const shown = proposed.flatMap((help) => {
    const added = addHelp(deps, {
      verb: "horizon",
      kind: help.kind,
      text: help.text,
      domain: subject.domain,
      ...(help.criterion === undefined ? {} : { criterion: help.criterion }),
      ...(help.answer === undefined ? {} : { answer: help.answer }),
      ...(subject.task === undefined ? {} : { task: subject.task }),
    });
    return added.horizon ?? [];
  });
  return response("horizon", { horizon: shown });
};
