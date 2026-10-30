import { closest } from "../core/suggest.js";
import type { PolicyIssue, PolicyIssueKind } from "./policy.js";

export const issue = (
  kind: PolicyIssueKind,
  file: string,
  key: string,
  candidates: readonly string[],
  value: string = key,
): PolicyIssue => {
  const suggestion = closest(value, candidates);
  return suggestion === undefined ? { kind, file, key } : { kind, file, key, suggestion };
};
