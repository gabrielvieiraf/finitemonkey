import { isRecord, type JsonObject } from "../core/parsed.js";
import { type Verb, VERBS } from "./response.js";
import {
  CRITERION_KINDS,
  type CriterionKind,
  HORIZON_KINDS,
  type HorizonKind,
  oneOf,
  PROOF_KINDS,
  type ProofKind,
  type ProofResult,
  RESULTS,
} from "./types.js";

export type JudgeRequest =
  | {
      readonly verb: "observe";
      readonly concepts: readonly string[];
      readonly text?: string;
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
  | { readonly verb: "forget"; readonly id?: string }
  | {
      readonly verb: "concept";
      readonly label: string;
      readonly domain: string;
      readonly synonyms: readonly string[];
      readonly source: string;
      readonly span: string;
    }
  | { readonly verb: "domain"; readonly domain: string; readonly parent?: string }
  | { readonly verb: "judge"; readonly claim: string; readonly decision?: string; readonly task?: string }
  | { readonly verb: "answer"; readonly probe: string; readonly choice: number }
  | { readonly verb: "cut"; readonly claim: string }
  | { readonly verb: "check"; readonly claim: string; readonly says: "verified" | "mismatch" }
  | { readonly verb: "read"; readonly origin: string; readonly source: string; readonly content: string }
  | { readonly verb: "promote"; readonly claim: string }
  | {
      readonly verb: "horizon";
      readonly kind: HorizonKind;
      readonly text: string;
      readonly domain: string;
      readonly criterion?: CriterionKind;
      readonly answer?: string;
      readonly task?: string;
    }
  | { readonly verb: "accept"; readonly help: string }
  | { readonly verb: "dismiss"; readonly help: string }
  | { readonly verb: "anchor"; readonly claim: string; readonly run: string; readonly inputs: readonly string[] };

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
  const said = text(record, "text");
  if (said !== undefined) return { verb: "observe", concepts, text: said, proof: "exposure", result: "pass" };
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
  concept: (record) => {
    const [label, domain] = [text(record, "label"), text(record, "domain")];
    if (label === undefined || domain === undefined) return undefined;
    const [source, span] = [text(record, "source"), text(record, "span")];
    if (source === undefined || span === undefined) return undefined;
    return { verb: "concept", label, domain, synonyms: list(record, "synonyms"), source, span };
  },
  judge: (record) => {
    const claim = text(record, "claim");
    return claim === undefined ? undefined : { verb: "judge", claim, ...optional(record, ["decision", "task"]) };
  },
  answer: (record) => {
    const probe = text(record, "probe");
    const raw = record["choice"];
    const choice = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return probe === undefined || !Number.isInteger(choice) ? undefined : { verb: "answer", probe, choice };
  },
  check: (record) => {
    const claim = text(record, "claim");
    const says = record["says"];
    if (claim === undefined || (says !== "verified" && says !== "mismatch")) return undefined;
    return { verb: "check", claim, says };
  },
  read: (record) => {
    const [origin, source, content] = [text(record, "origin"), text(record, "source"), text(record, "content")];
    return origin === undefined || source === undefined || content === undefined
      ? undefined
      : { verb: "read", origin, source, content };
  },
  promote: (record) => {
    const claim = text(record, "claim");
    return claim === undefined ? undefined : { verb: "promote", claim };
  },
  horizon: (record) => {
    const kind = oneOf(HORIZON_KINDS, record["kind"]);
    const [helpText, domain] = [text(record, "text"), text(record, "domain")];
    if (kind === undefined || helpText === undefined || domain === undefined) return undefined;
    const criterion = oneOf(CRITERION_KINDS, record["criterion"]);
    return {
      verb: "horizon",
      kind,
      text: helpText,
      domain,
      ...(criterion === undefined ? {} : { criterion }),
      ...optional(record, ["answer", "task"]),
    };
  },
  accept: (record) => {
    const help = text(record, "help");
    return help === undefined ? undefined : { verb: "accept", help };
  },
  dismiss: (record) => {
    const help = text(record, "help");
    return help === undefined ? undefined : { verb: "dismiss", help };
  },
  anchor: (record) => {
    const [claim, run] = [text(record, "claim"), text(record, "run")];
    const inputs = list(record, "inputs");
    return claim === undefined || run === undefined || inputs.length === 0
      ? undefined
      : { verb: "anchor", claim, run, inputs };
  },
  cut: (record) => {
    const claim = text(record, "claim");
    return claim === undefined ? undefined : { verb: "cut", claim };
  },
  domain: (record) => {
    const domain = text(record, "domain");
    return domain === undefined ? undefined : { verb: "domain", domain, ...optional(record, ["parent"]) };
  },
};

export const parseRequest = (value: unknown): JudgeRequest | undefined => {
  if (!isRecord(value)) return undefined;
  const verb = oneOf(VERBS, value["verb"]);
  return verb === undefined ? undefined : BUILDERS[verb](value);
};
