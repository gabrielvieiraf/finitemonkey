import type { Runtime } from "../core/runtime.js";
import { DECISION_FILE } from "../decide/check.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";
import type { FmPaths } from "../task/paths.js";
import {
  type Assumption,
  fileHash,
  LEVELS3,
  nextAssumptionId,
  readAssumptions,
  type Trigger,
  TRIGGER_KINDS,
  writeAssumptions,
} from "./assumptions.js";
import { readRecord } from "./record.js";

export type AssumptionDraft = Omit<Assumption, "id" | "source" | "status" | "at">;

const FIELDS = ["impact", "confidence", "verify", "trigger", "breaks"] as const;

const triggerFrom = (raw: string): Omit<Trigger, "hash"> | undefined => {
  const match = /^(\w+):(.+)$/.exec(raw.trim());
  const kind = TRIGGER_KINDS.find((item) => item === match?.[1]);
  return kind === undefined || match?.[2] === undefined ? undefined : { kind, value: match[2].trim() };
};

export const draftOf = (line: string): AssumptionDraft => {
  const [head = "", ...parts] = line.split(" | ");
  const fields = new Map(
    parts.flatMap((part) => {
      const match = /^\s*(\w+)\s*:\s*(.*)$/.exec(part);
      const key = FIELDS.find((item) => item === match?.[1]);
      return key === undefined ? [] : [[key, (match?.[2] ?? "").trim()] as const];
    }),
  );
  const trigger = triggerFrom(fields.get("trigger") ?? "");
  return {
    text: head.replace(/\*+/g, "").trim(),
    impact: LEVELS3.find((item) => item === fields.get("impact")) ?? "medium",
    confidence: LEVELS3.find((item) => item === fields.get("confidence")) ?? "medium",
    verify: fields.get("verify") ?? "",
    breaks: fields.get("breaks") ?? "",
    ...(trigger === undefined ? {} : { trigger }),
  };
};

const withHash = (runtime: Pick<Runtime, "readText">, paths: FmPaths, draft: AssumptionDraft): AssumptionDraft =>
  draft.trigger?.kind === "file"
    ? { ...draft, trigger: { ...draft.trigger, hash: fileHash(runtime, paths.root, draft.trigger.value) } }
    : draft;

export const registerAssumptions = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "now">,
  paths: FmPaths,
  source: string,
  drafts: readonly AssumptionDraft[],
): readonly Assumption[] => {
  const list = readAssumptions(runtime, paths);
  const added = drafts
    .filter((draft) => draft.text !== "")
    .filter((draft) => !list.some((item) => item.source === source && item.text === draft.text))
    .reduce<readonly Assumption[]>(
      (acc, draft) => [
        ...acc,
        {
          id: nextAssumptionId([...list, ...acc]),
          source,
          status: "unverified",
          at: runtime.now(),
          ...withHash(runtime, paths, draft),
        },
      ],
      [],
    );
  if (added.length > 0) writeAssumptions(runtime, paths, [...list, ...added]);
  return added;
};

export const exportDecisionAssumptions = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "now" | "listDir">,
  paths: FmPaths,
): readonly Assumption[] =>
  planFiles(runtime, paths.root)
    .filter((name) => DECISION_FILE.test(name))
    .flatMap((name) => {
      const text = runtime.readText(planPath(paths.root, name));
      if (!text.ok) return [];
      const lines = readRecord(text.value).assumptions;
      return lines.length === 0 ? [] : registerAssumptions(runtime, paths, `${PLAN_DIR}/${name}`, lines.map(draftOf));
    });
