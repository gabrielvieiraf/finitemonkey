import { isRecord, type JsonObject } from "../core/parsed.js";
import { type Verb, VERBS } from "./response.js";
import { oneOf, PROOF_KINDS, type ProofKind, type ProofResult, RESULTS } from "./types.js";

export type JudgeRequest =
  | {
      readonly verb: "observe";
      readonly concepts: readonly string[];
      readonly proof: ProofKind;
      readonly result: ProofResult;
      readonly ref?: string;
      readonly claim?: string;
    }
  | {
      readonly verb: "classify";
      readonly file: string;
      readonly text: string;
      readonly task?: string;
      readonly domain?: string;
    }
  | { readonly verb: "verify"; readonly claim: string }
  | {
      readonly verb: "ask";
      readonly task: string;
      readonly decision: string;
      readonly question: string;
      readonly criterion: string;
    }
  | { readonly verb: "handoff"; readonly claim: string; readonly to: string; readonly missing: string }
  | { readonly verb: "contest"; readonly target: string; readonly reason?: string }
  | { readonly verb: "fade"; readonly concept?: string }
  | { readonly verb: "report" }
  | { readonly verb: "export" }
  | { readonly verb: "forget"; readonly id?: string };

const text = (record: JsonObject, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

const optional = (record: JsonObject, keys: readonly string[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const found = text(record, key);
      return found === undefined ? [] : [[key, found]];
    }),
  );

const list = (record: JsonObject, key: string): readonly string[] => {
  const value = record[key];
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
};

const observeOf = (record: JsonObject): JudgeRequest | undefined => {
  const proof = oneOf(PROOF_KINDS, record["proof"]);
  const result = oneOf(RESULTS, record["result"]) ?? "pass";
  const concepts = list(record, "concepts");
  if (proof === undefined || concepts.length === 0) return undefined;
  return { verb: "observe", concepts, proof, result, ...optional(record, ["ref", "claim"]) };
};

const BUILDERS: Readonly<Record<Verb, (record: JsonObject) => JudgeRequest | undefined>> = {
  observe: observeOf,
  classify: (record) => {
    const [file, body] = [text(record, "file"), text(record, "text")];
    if (file === undefined || body === undefined) return undefined;
    return { verb: "classify", file, text: body, ...optional(record, ["task", "domain"]) };
  },
  verify: (record) => {
    const claim = text(record, "claim");
    return claim === undefined ? undefined : { verb: "verify", claim };
  },
  ask: (record) => {
    const [task, decision, question, criterion] = ["task", "decision", "question", "criterion"].map((key) =>
      text(record, key),
    );
    if (task === undefined || decision === undefined || question === undefined || criterion === undefined)
      return undefined;
    return { verb: "ask", task, decision, question, criterion };
  },
  handoff: (record) => {
    const [claim, to, missing] = ["claim", "to", "missing"].map((key) => text(record, key));
    if (claim === undefined || to === undefined || missing === undefined) return undefined;
    return { verb: "handoff", claim, to, missing };
  },
  contest: (record) => {
    const target = text(record, "target");
    return target === undefined ? undefined : { verb: "contest", target, ...optional(record, ["reason"]) };
  },
  fade: (record) => ({ verb: "fade", ...optional(record, ["concept"]) }),
  report: () => ({ verb: "report" }),
  export: () => ({ verb: "export" }),
  forget: (record) => ({ verb: "forget", ...optional(record, ["id"]) }),
};

export const parseRequest = (value: unknown): JudgeRequest | undefined => {
  if (!isRecord(value)) return undefined;
  const verb = oneOf(VERBS, value["verb"]);
  return verb === undefined ? undefined : BUILDERS[verb](value);
};
