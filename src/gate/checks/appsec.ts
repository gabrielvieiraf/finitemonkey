import { contextFor, scanFiles } from "../../appsec/scan.js";
import { APPSEC_CHECK, type AppsecFinding, OWASP } from "../../appsec/types.js";
import { type DataMapProblem, dataMapProblems } from "../../datamap/check.js";
import { keyOf } from "../../datamap/map.js";
import type { Note } from "../../evidence/types.js";
import { loadBaseline, ratchetFor } from "../../findings/baseline.js";
import { loadPolicy } from "../../policy/policy.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const MAX_LISTED = 10;

const findingNote = (key: string, finding: AppsecFinding): Note =>
  note(key, {
    file: finding.file,
    line: finding.line,
    rule: finding.rule,
    owasp: OWASP[finding.owasp],
    id: finding.id,
  });

const dataMapNote = (problem: DataMapProblem): Note => {
  if (problem.kind === "ai")
    return note("gate.datamap.ai", { field: problem.key, file: problem.file, line: problem.line });
  const params = { field: keyOf(problem.field), file: problem.field.file, line: problem.field.line };
  return note(problem.kind === "missing" ? "gate.datamap.missing" : "gate.datamap.incomplete", params);
};

export const appsecCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const { runtime, paths } = ctx;
  const baseline = loadBaseline(runtime, paths.root);
  if (!baseline.ok)
    return unverified("tool_missing", [note("gate.appsec.baseline_invalid", { detail: baseline.error })]);
  const changed = ctx.changes.filter((change) => change.status !== "D").map((change) => change.path);
  const found = scanFiles(runtime, paths.root, changed, contextFor(runtime, paths.root));
  const outcome = ratchetFor(APPSEC_CHECK, found, baseline.value, runtime.now(), undefined);
  const dataMap = dataMapProblems(runtime, paths.root, changed);
  const notes = [
    ...outcome.fresh.slice(0, MAX_LISTED).map((finding) => findingNote("gate.appsec.finding", finding)),
    ...outcome.expired.slice(0, MAX_LISTED).map((finding) => findingNote("gate.appsec.expired", finding)),
    ...dataMap.slice(0, MAX_LISTED).map(dataMapNote),
  ];
  if (notes.length === 0) return passed([note("gate.appsec.clean", { known: outcome.known.length })]);
  return loadPolicy(runtime, paths.root).level === "light" ? passed(notes) : failed(notes);
};
