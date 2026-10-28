import { importEdges } from "../../arch/imports.js";
import { workingTree } from "../../arch/scan.js";
import type { Note } from "../../evidence/types.js";
import { type FileChange, newLogic, type ReExport, removedReExports } from "../../organize/move.js";
import { baseText, guardMode, readWorking } from "../../quality/gate-sources.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { languageOf } from "../callers/languages.js";
import { type CheckOutcome, failed, type GateContext, note, passed } from "../types.js";

export const ORGANIZE_FEATURE = "organize";
const MAX_LISTED = 8;

interface OpenCaller {
  readonly file: string;
  readonly name: string;
  readonly origin: string;
}

const fileChanges = (ctx: GateContext): readonly FileChange[] =>
  ctx.changes
    .filter((change) => languageOf(change.path) !== undefined)
    .map((change) => ({
      path: change.path,
      before: baseText(ctx, change.path),
      after: change.status === "D" ? undefined : readWorking(ctx, change.path),
    }));

const importsName = (text: string, name: string): boolean =>
  text
    .split(/\r?\n/)
    .some((line) => /\b(?:import|require|from)\b/.test(line) && new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(line));

const openCallers = (ctx: GateContext, removed: readonly ReExport[]): readonly OpenCaller[] => {
  if (removed.length === 0) return [];
  const tree = workingTree(ctx.runtime, ctx.git, ctx.paths.root, ctx.changes);
  const edges = importEdges(tree);
  return removed.flatMap((item) =>
    edges
      .filter((edge) => edge.to === item.file)
      .flatMap((edge) => {
        const text = tree.read(edge.from) ?? "";
        return item.names
          .filter((name) => importsName(text, name))
          .map((name) => ({ file: edge.from, name, origin: item.file }));
      }),
  );
};

export const organizeCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = guardMode(ctx, ORGANIZE_FEATURE);
  if (mode === "off") return passed([note("gate.organize.off")]);
  const changes = fileChanges(ctx);
  const logic = newLogic(changes);
  const open = openCallers(ctx, removedReExports(changes));
  const notes: Note[] = [
    ...logic
      .slice(0, MAX_LISTED)
      .map((item) => note("gate.organize.logic", { file: item.file, line: item.line, text: ctx.mask(item.text) })),
    ...open.slice(0, MAX_LISTED).map((item) => note("gate.organize.open_caller", { ...item })),
  ];
  if (notes.length === 0) return passed([note("gate.organize.clean")]);
  if (mode === "shadow") return passed([note("gate.organize.shadow"), ...notes]);
  return failed([...notes, note("gate.organize.fix")]);
};
