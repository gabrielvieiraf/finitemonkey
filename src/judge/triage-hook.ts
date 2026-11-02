import { relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { optionalString } from "../core/parsed.js";
import { projectPaths } from "../gate/hooks/common.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { RECORD_DIR } from "../knowledge/decision-record.js";
import { toolInput, toolName, type WrittenText, writtenTexts } from "../secrets/guards/tool-input.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import type { XrayRow } from "./response.js";
import { DOCUMENT, triageRows } from "./triage.js";
import { raiseTriage, triageLines, triageOff } from "./triage-raise.js";
import { commitRows, decisionRows, type TriageTrigger } from "./triage-triggers.js";
import type { JudgeEntry } from "./types.js";

const allow = { kind: "allow" } as const;

const GIT_COMMIT = /(?:^|[;&|]\s*)git\s+(?:-[^\s]+\s+)*commit\b/;

const partsOf = (paths: FmPaths, file: string): readonly string[] => relative(paths.root, file).split(/[\\/]/);

const isRecordFile = (paths: FmPaths, file: string): boolean => {
  const parts = partsOf(paths, file);
  return parts[0] === ".finitemonkey" && parts[1] === RECORD_DIR && file.endsWith(".json");
};

const wholeText = (input: HookInput, item: WrittenText): string => {
  const text = input.runtime.readText(toAbsolutePath(item.file, input.cwd));
  return text.ok ? text.value : item.text;
};

type RowPick = (entries: readonly JudgeEntry[]) => readonly XrayRow[];

const pickOf = (
  input: HookInput,
  paths: FmPaths,
): { readonly trigger: TriageTrigger; readonly pick: RowPick } | undefined => {
  const tool = toolName(input.payload);
  if (tool === "Bash") {
    if (!GIT_COMMIT.test(optionalString(toolInput(input.payload), "command") ?? "")) return undefined;
    const message = input.runtime.git(["log", "-1", "--format=%B"], paths.root);
    return message.ok ? { trigger: "commit", pick: (entries) => commitRows(entries, message.stdout) } : undefined;
  }
  const written = writtenTexts(tool, toolInput(input.payload));
  const records = written.filter((item) => isRecordFile(paths, item.file));
  if (records.length > 0)
    return {
      trigger: "decision",
      pick: (entries) => records.flatMap((item) => decisionRows(entries, wholeText(input, item))),
    };
  const docs = written.filter(
    (item) => DOCUMENT.test(item.file) && !partsOf(paths, item.file).includes(".finitemonkey"),
  );
  return docs.length === 0
    ? undefined
    : { trigger: "document", pick: (entries) => docs.flatMap((doc) => triageRows(entries, doc.text)) };
};

export const triageAfterWrite: HookHandler = (input): HookDecision => {
  const paths = projectPaths(input);
  if (paths === undefined || triageOff(input.runtime, paths)) return allow;
  const found = pickOf(input, paths);
  if (found === undefined) return allow;
  const task = readState(input.runtime, paths).active ?? "none";
  const rows = raiseTriage(input.runtime, paths, { task, ...found });
  return rows.length === 0 ? allow : { kind: "block", reason: triageLines(input.t, found.trigger, rows).join("\n") };
};

export const TRIAGE_HANDLERS: HookHandlers = { PostToolUse: [triageAfterWrite] };
