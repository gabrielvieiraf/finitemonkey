import { toAbsolutePath } from "../core/brand.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { onceFor } from "../guardian/once.js";
import type { HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { type Sheet, SHEET_FEATURE } from "./sheet.js";
import { activeSheetRefs, type SheetRef } from "./sheet-contract.js";
import { readSheet } from "./sheet-store.js";

const MAX_VARIABLES = 12;

const variableText = (sheet: Sheet): string =>
  sheet.variables
    .slice(0, MAX_VARIABLES)
    .map((variable) =>
      [variable.name, `${String(variable.px)}px`, variable.token ?? (variable.offScale ? "off-scale" : "")]
        .filter((part) => part !== "")
        .join(" "),
    )
    .join(", ");

export const sheetSummary = (t: Translate, ref: SheetRef, sheet: Sheet | undefined): string =>
  [
    t("look.sheet.inject", { route: ref.route, selector: ref.selector, file: ref.file, variables: ref.variables }),
    ...(sheet === undefined || sheet.variables.length === 0 ? [] : [variableText(sheet)]),
  ].join("\n");

const due = (input: HookInput, paths: FmPaths, task: string, mode: string): readonly SheetRef[] =>
  activeSheetRefs(input.runtime, paths).filter((ref) =>
    onceFor(input.runtime, paths, `ui-sheet-${mode}.json`, `${task}\u0000${ref.route}\u0000${ref.hash}`),
  );

export const sheetPrompt: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined) return { kind: "allow" };
  const mode = featureMode(input.runtime, paths, SHEET_FEATURE);
  const task = readState(input.runtime, paths).active;
  if (mode === "off" || task === undefined) return { kind: "allow" };
  const refs = due(input, paths, task, mode);
  if (refs.length === 0) return { kind: "allow" };
  if (mode === "shadow") {
    for (const ref of refs) recordFeatureShadow(input.runtime, paths, SHEET_FEATURE, { task, route: ref.route });
    return { kind: "allow" };
  }
  const text = refs
    .map((ref) => sheetSummary(input.t, ref, readSheet(input.runtime, toAbsolutePath(ref.file, paths.root))))
    .join("\n\n");
  return { kind: "allow", output: contextOutput("UserPromptSubmit", text) };
};

export const SHEET_HANDLERS: HookHandlers = { UserPromptSubmit: [sheetPrompt] };
