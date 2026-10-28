import { logEvent } from "../evidence/log.js";
import { human } from "../gate/hooks/common.js";
import { type GateStatus, type GateStatusKind, readGateStatus } from "../gate/hooks/status.js";
import { grantFor } from "../guards/context.js";
import { isTestFile } from "../guards/tests/patterns.js";
import { textField } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { scopeOf, type SignalScope } from "../signals/context.js";
import { shortHash } from "../signals/signature.js";
import { sessionEntries, type SignalEntry } from "../signals/store.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { completionClaim } from "./detect.js";

export const CLAIMS_GUARD = "claims";
const BLOCKED_FILE = "claims.json";
const KEEP_KEYS = 50;
const CONTRACT_DIR = ".finitemonkey/tasks/";

const allow = { kind: "allow" } as const;

type Edit = Extract<SignalEntry, { kind: "edit" }>;

type UnconfirmedState = Exclude<GateStatusKind, "passed"> | "stale";

interface Unconfirmed {
  readonly state: UnconfirmedState;
  readonly detail: string;
  readonly at: string;
}

const unconfirmed = (status: GateStatus | undefined, lastEdit: string): Unconfirmed | undefined => {
  if (status === undefined) return { state: "not_run", detail: "", at: "" };
  if (status.status === "passed") {
    return status.at >= lastEdit ? undefined : { state: "stale", detail: status.task, at: status.at };
  }
  return { state: status.status, detail: status.detail, at: status.at };
};

const guardedFiles = (edits: readonly Edit[]): readonly string[] => [
  ...new Set(edits.flatMap((edit) => (isTestFile(edit.file) || edit.file.startsWith(CONTRACT_DIR) ? [edit.file] : []))),
];

const blockedKeys = (scope: SignalScope): readonly string[] => {
  const raw = readJsonFile(scope.input.runtime, scope.paths.cache(BLOCKED_FILE))?.["blocked"];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
};

const firstTime = (scope: SignalScope, key: string): boolean => {
  const keys = blockedKeys(scope);
  if (keys.includes(key)) return false;
  writeJsonFile(scope.input.runtime, scope.paths.cache(BLOCKED_FILE), { blocked: [...keys, key].slice(-KEEP_KEYS) });
  return true;
};

const reasons = (
  scope: SignalScope,
  claim: string,
  gate: Unconfirmed | undefined,
  files: readonly string[],
): readonly { readonly model: string; readonly human: string }[] => {
  const { t } = scope.input;
  const state = gate === undefined ? "" : t(`claims.state.${gate.state}`);
  return [
    ...(gate === undefined
      ? []
      : [
          {
            model: modelReason(t, "claims.block.unconfirmed", { claim, state, detail: gate.detail || "-" }),
            human: t("claims.block.unconfirmed.human", { state }),
          },
        ]),
    ...(files.length === 0
      ? []
      : [
          {
            model: modelReason(t, "claims.block.tests", { claim, files: files.join(", ") }),
            human: t("claims.block.tests.human", { count: files.length, files: files.join(", ") }),
          },
        ]),
  ];
};

const judge = (scope: SignalScope, claim: string, edits: readonly Edit[]): HookDecision => {
  const { input } = scope;
  const lastEdit = edits.at(-1)?.at ?? "";
  const gate = unconfirmed(readGateStatus(input.runtime, scope.paths), lastEdit);
  const files = grantFor(input, CLAIMS_GUARD) === undefined ? guardedFiles(edits) : [];
  if (gate !== undefined) logEvent(input.runtime, scope.paths, "claims.unconfirmed", { state: gate.state });
  if (files.length > 0) logEvent(input.runtime, scope.paths, "claims.test_edits", { files: [...files] });
  const found = reasons(scope, claim, gate, files);
  if (found.length === 0) return allow;
  const key = shortHash([scope.session, gate?.state ?? "", gate?.at ?? "", lastEdit, ...files].join("|"));
  if (!firstTime(scope, key)) return allow;
  const reason = found.map((item) => item.model).join("\n\n");
  return {
    kind: "block",
    reason,
    persistent: true,
    output: { decision: "block", reason, systemMessage: human(found.map((item) => item.human).join(" ")) },
  };
};

export const claimGuard: HookHandler = (input) => {
  const claim = completionClaim(textField(input.payload.raw, "last_assistant_message") ?? "");
  if (claim === undefined) return allow;
  const scope = scopeOf(input);
  if (scope === undefined) return allow;
  const edits = sessionEntries(scope.entries, scope.session).filter((entry): entry is Edit => entry.kind === "edit");
  return edits.length === 0 ? allow : judge(scope, claim, edits);
};

export const CLAIMS_HANDLERS: HookHandlers = { Stop: [claimGuard] };
