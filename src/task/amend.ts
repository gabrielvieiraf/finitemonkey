import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type Parsed, parseJsonObject, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { stringifyYaml } from "../core/yaml/write.js";
import type { FmPaths } from "./paths.js";
import { invalidate, readContract } from "./reopen.js";
import { contractYaml } from "./serialize.js";
import type { AcceptanceCheck } from "./types.js";

export const AMENDMENTS_FILE = "amendments.jsonl";

export interface Amendment {
  readonly task: string;
  readonly criterion: string;
  readonly reason: string;
  readonly evidence: string;
  readonly before: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
  readonly at: string;
  readonly by: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
}

export interface AmendRequest {
  readonly task: string;
  readonly criterion: string;
  readonly reason: string;
  readonly evidence: string;
  readonly run?: string;
  readonly description?: string;
}

export type AmendProblem = "not_found" | "unknown_criterion" | "no_change" | "write";

export const amendmentsPath = (paths: FmPaths): AbsolutePath =>
  toAbsolutePath(join(paths.dir, "tasks", AMENDMENTS_FILE));

const fields = (check: AcceptanceCheck): Readonly<Record<string, string>> => ({
  ...(check.run === undefined ? {} : { run: check.run }),
  ...(check.description === undefined ? {} : { description: check.description }),
});

export const amendTask = (runtime: Runtime, paths: FmPaths, request: AmendRequest): Parsed<Amendment, AmendProblem> => {
  const contract = readContract(runtime, paths, request.task);
  if (contract === undefined) return reject("not_found");
  const check = contract.acceptance.find((item) => item.id === request.criterion);
  if (check === undefined) return reject("unknown_criterion");
  const changed: AcceptanceCheck = {
    ...check,
    ...(request.run === undefined ? {} : { run: request.run }),
    ...(request.description === undefined ? {} : { description: request.description }),
  };
  if (JSON.stringify(fields(changed)) === JSON.stringify(fields(check))) return reject("no_change");
  const next = { ...contract, acceptance: contract.acceptance.map((item) => (item.id === check.id ? changed : item)) };
  if (!runtime.writeText(paths.task(contract.id), stringifyYaml(contractYaml(next))).ok) return reject("write");
  invalidate(runtime, paths, next, [check.id]);
  const amendment: Amendment = {
    task: contract.id,
    criterion: check.id,
    reason: request.reason,
    evidence: request.evidence,
    before: fields(check),
    after: fields(changed),
    at: runtime.now(),
    by: "finitemonkey task amend",
  };
  return runtime.appendText(amendmentsPath(paths), `${JSON.stringify(amendment)}\n`).ok
    ? accept(amendment)
    : reject("write");
};

export const approveAmendments = (runtime: Runtime, paths: FmPaths, task: string, by: string): number => {
  const text = runtime.readText(amendmentsPath(paths));
  if (!text.ok) return 0;
  const pending = text.value.split("\n").flatMap((line) => {
    const parsed = parseJsonObject(line);
    return parsed.ok && isRecord(parsed.value) && parsed.value["task"] === task ? [parsed.value] : [];
  });
  const approved = new Set(
    pending
      .filter((item) => item["approvedBy"] !== undefined)
      .map((item) => `${String(item["criterion"])}@${String(item["at"])}`),
  );
  const open = pending.filter(
    (item) => item["approvedBy"] === undefined && !approved.has(`${String(item["criterion"])}@${String(item["at"])}`),
  );
  if (open.length === 0) return 0;
  const at = runtime.now();
  const lines = open.map((item) => `${JSON.stringify({ ...item, approvedBy: by, approvedAt: at })}\n`).join("");
  return runtime.appendText(amendmentsPath(paths), lines).ok ? open.length : 0;
};
