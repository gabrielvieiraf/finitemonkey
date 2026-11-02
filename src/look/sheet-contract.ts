import { dirname } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { accept, isRecord, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml } from "../core/yaml/parse.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { approveUi, uiContractPath, uiContractState, uiHash } from "./contract.js";

export interface SheetRef {
  readonly route: string;
  readonly selector: string;
  readonly file: string;
  readonly hash: string;
  readonly variables: number;
}

export const sheetHash = (text: string): string => sha256Hex(text).slice(0, 16);

const refOf = (value: unknown): SheetRef | undefined => {
  if (!isRecord(value)) return undefined;
  const { route, selector, file, hash, variables } = value;
  return typeof route === "string" && typeof file === "string" && typeof hash === "string"
    ? {
        route,
        selector: typeof selector === "string" ? selector : "main",
        file,
        hash,
        variables: typeof variables === "number" ? variables : 0,
      }
    : undefined;
};

export const sheetRefs = (source: string): readonly SheetRef[] => {
  const parsed = parseYaml(source);
  const list = parsed.ok && isRecord(parsed.value) ? parsed.value["sheets"] : undefined;
  return Array.isArray(list) ? list.flatMap((item: unknown) => refOf(item) ?? []) : [];
};

const withoutSheets = (source: string): string => {
  const kept: string[] = [];
  let inside = false;
  for (const line of source.split("\n")) {
    if (/^sheets\s*:/.test(line)) inside = true;
    else if (inside && line !== "" && !/^[\s-]/.test(line)) inside = false;
    if (!inside) kept.push(line);
  }
  return kept.join("\n").replace(/\n+$/, "");
};

export const withSheetEntry = (source: string | undefined, ref: SheetRef): string => {
  const base = source === undefined || source.trim() === "" ? "ui: []" : withoutSheets(source);
  const refs = [...(source === undefined ? [] : sheetRefs(source).filter((item) => item.route !== ref.route)), ref].map(
    (item) => ({ ...item }),
  );
  return `${base}\n${stringifyYaml({ sheets: refs })}`;
};

export interface SheetApproval {
  readonly contractHash: string;
  readonly relocked: boolean;
}

export const approveSheetInContract = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  paths: FmPaths,
  task: string,
  ref: SheetRef,
): Parsed<SheetApproval> => {
  const before = uiContractState(runtime, paths, task);
  const current = runtime.readText(uiContractPath(paths, task));
  const next = withSheetEntry(current.ok ? current.value : undefined, ref);
  const target = uiContractPath(paths, task);
  runtime.mkdir(toAbsolutePath(dirname(target)));
  const wrote = runtime.writeText(target, next);
  if (!wrote.ok) return reject(wrote.error);
  if (!before.approved) return accept({ contractHash: uiHash(next), relocked: false });
  const locked = approveUi(runtime, paths, task, uiHash(next));
  return locked.ok ? accept({ contractHash: locked.value, relocked: true }) : reject(locked.error);
};

export const activeSheetRefs = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly SheetRef[] => {
  const task = readState(runtime, paths).active;
  const source = task === undefined ? undefined : runtime.readText(uiContractPath(paths, task));
  return source?.ok === true ? sheetRefs(source.value) : [];
};

export const boundToContract = (refs: readonly SheetRef[], route: string, text: string): boolean => {
  const ref = refs.find((item) => item.route === route);
  return ref === undefined || ref.hash === sheetHash(text);
};
