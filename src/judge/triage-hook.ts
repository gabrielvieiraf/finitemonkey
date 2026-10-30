import { relative } from "node:path";

import { projectPaths } from "../gate/hooks/common.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { featureMode } from "../policy/feature.js";
import { toolInput, toolName, writtenTexts } from "../secrets/guards/tool-input.js";
import { readState } from "../task/state.js";
import { appendEntry, entryId, readEntries } from "./store.js";
import { DOCUMENT, flagsFor, TRIAGE_CLAIMS_PER_FLAG, TRIAGE_FLAGS_PER_TASK, triageRows } from "./triage.js";
import { JUDGE_FEATURE } from "./types.js";

const allow = { kind: "allow" } as const;

export const triageAfterWrite: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || featureMode(input.runtime, paths, JUDGE_FEATURE) === "off") return allow;
  const docs = writtenTexts(toolName(input.payload), toolInput(input.payload)).filter(
    (item) => DOCUMENT.test(item.file) && !relative(paths.root, item.file).split(/[\\/]/).includes(".finitemonkey"),
  );
  if (docs.length === 0) return allow;
  const entries = readEntries(input.runtime, paths);
  const task = readState(input.runtime, paths).active ?? "none";
  const flagged = flagsFor(entries, task);
  const rows = docs
    .flatMap((doc) => triageRows(entries, doc.text))
    .filter((row) => !flagged.claims.includes(row.claim))
    .slice(0, TRIAGE_CLAIMS_PER_FLAG);
  if (rows.length === 0 || flagged.flags >= TRIAGE_FLAGS_PER_TASK) return allow;
  const flag = entryId("t", task, input.runtime.now());
  for (const row of rows)
    appendEntry(input.runtime, paths, {
      type: "signal",
      id: entryId("g", task, row.claim),
      at: input.runtime.now(),
      family: "triage-flag",
      confidence: 0,
      state: "shadow",
      ref: [task, flag, row.claim].join("\u0000"),
    });
  const lines = rows.map((row) => input.t("judge.triage.row", { claim: row.claim, band: row.band, text: row.text }));
  return { kind: "block", reason: [input.t("judge.triage.head", { count: rows.length }), ...lines].join("\n") };
};

export const TRIAGE_HANDLERS: HookHandlers = { PostToolUse: [triageAfterWrite] };
