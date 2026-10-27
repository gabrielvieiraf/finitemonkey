import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { linesOf, pathspecOf, resolveCommit } from "../inventory/grep.js";
import { planDir, planPath } from "../plan/folder.js";
import { textList } from "../plan/front.js";
import { capabilitiesAt, type Capability } from "./capabilities.js";
import { nextId, PARITY_FILE, PARITY_STATE_FILE, type ParityRow, parseParity, renderParity } from "./table.js";

export const PARITY_SCHEMA = "finitemonkey/parity@1";

export type ParityProblem = "ref" | "exists" | "missing" | "write";

export interface ParityWritten {
  readonly rows: number;
  readonly added: number;
  readonly hash: string;
}

interface ParityState {
  readonly hash: string;
  readonly covered: readonly string[];
}

const rowOf = (id: number, capability: Capability, state: string): ParityRow => ({
  id: `P${String(id)}`,
  capability: capability.text,
  whereToday: capability.where,
  destination: "",
  parityTest: "",
  state,
  decision: "",
});

const save = (runtime: Runtime, root: AbsolutePath, rows: readonly ParityRow[], state: ParityState): boolean => {
  const made = runtime.mkdir(planDir(root));
  const table = made.ok && runtime.writeText(planPath(root, PARITY_FILE), renderParity(rows)).ok;
  const json = JSON.stringify({ schema: PARITY_SCHEMA, ...state }, null, 2);
  return table && runtime.writeText(planPath(root, PARITY_STATE_FILE), `${json}\n`).ok;
};

export const initParity = (
  runtime: Runtime,
  root: AbsolutePath,
  ref: string,
  covered: readonly string[],
): Parsed<ParityWritten, ParityProblem> => {
  if (runtime.readText(planPath(root, PARITY_FILE)).ok) return reject("exists");
  const git = gitAt(runtime, root);
  const hash = resolveCommit(git, ref);
  if (hash === undefined) return reject("ref");
  const rows = capabilitiesAt(git, hash, covered).map((capability, index) => rowOf(index + 1, capability, "pending"));
  if (!save(runtime, root, rows, { hash, covered: covered.length === 0 ? ["."] : covered })) return reject("write");
  return accept({ rows: rows.length, added: rows.length, hash });
};

const readState = (runtime: Runtime, root: AbsolutePath): ParityState | undefined => {
  const text = runtime.readText(planPath(root, PARITY_STATE_FILE));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true || !isRecord(parsed.value)) return undefined;
  const hash = parsed.value["hash"];
  return typeof hash === "string" ? { hash, covered: textList(parsed.value, "covered") } : undefined;
};

export const updateParity = (
  runtime: Runtime,
  root: AbsolutePath,
  ref: string,
): Parsed<ParityWritten, ParityProblem> => {
  const table = runtime.readText(planPath(root, PARITY_FILE));
  const state = readState(runtime, root);
  if (!table.ok || state === undefined) return reject("missing");
  const git = gitAt(runtime, root);
  const hash = resolveCommit(git, ref);
  if (hash === undefined) return reject("ref");
  const rows = parseParity(table.value);
  const changed = new Set(
    linesOf(git.out(["diff", "--name-only", state.hash, hash, "--", ...pathspecOf(state.covered)])),
  );
  const known = new Set(rows.map((row) => row.capability));
  const fresh = capabilitiesAt(git, hash, state.covered).filter(
    (capability) => changed.has(capability.where.replace(/:\d+$/, "")) && !known.has(capability.text),
  );
  const first = nextId(rows);
  const next = [...rows, ...fresh.map((capability, index) => rowOf(first + index, capability, "new"))];
  if (!save(runtime, root, next, { hash, covered: state.covered })) return reject("write");
  return accept({ rows: next.length, added: fresh.length, hash });
};
