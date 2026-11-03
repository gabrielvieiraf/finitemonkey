import { parseJsonObject } from "../core/parsed.js";
import { GATE_JUDGE_REQUEST, judgeProcess } from "./call.js";
import type { JudgeDeps } from "./deps.js";
import { parseRequest } from "./request.js";
import type { JudgeResponse } from "./response.js";
import { runVerb } from "./verbs.js";

export const gateJudgeCall = (deps: Pick<JudgeDeps, "runtime" | "paths">): JudgeResponse | undefined => {
  const call = judgeProcess(GATE_JUDGE_REQUEST);
  const parsed = parseJsonObject(call.stdin);
  const request = parsed.ok ? parseRequest(parsed.value) : undefined;
  return request === undefined ? undefined : runVerb(deps, request);
};
