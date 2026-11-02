import type { AddedLine } from "../gate/git.js";
import type { ConceptEventDraft } from "./evidence.js";
import { type ConceptProposer, proposedFor } from "./propose.js";
import { NO_PACKAGES, type PackageMap, type Recognition, recognizeCode } from "./recognize.js";

export const groupByFile = (added: readonly AddedLine[]): ReadonlyMap<string, readonly string[]> => {
  const files = new Map<string, string[]>();
  for (const line of added) files.set(line.path, [...(files.get(line.path) ?? []), line.text]);
  return files;
};

export const recognizedIn = (added: readonly AddedLine[], map: PackageMap = NO_PACKAGES): readonly Recognition[] =>
  [...groupByFile(added)].flatMap(([file, lines]) => recognizeCode({ file, lines }, map));

export interface Provenance {
  readonly agentFiles: ReadonlySet<string>;
  readonly repaired: boolean;
  readonly task: string;
  readonly packages?: PackageMap;
  readonly proposer?: ConceptProposer;
}

const recognizedEvents = (
  file: string,
  found: readonly Recognition[],
  provenance: Provenance,
): readonly ConceptEventDraft[] => {
  const agent = provenance.agentFiles.has(file);
  return found.map((item): ConceptEventDraft => ({
    concept: item.concept,
    kind: agent ? "exposure" : provenance.repaired ? "own_repair" : "own_change",
    origin: agent ? "agent" : "person",
    task: provenance.task,
    file,
    source: item.source,
    match: item.match,
  }));
};

const proposalEvents = (file: string, lines: readonly string[], provenance: Provenance): readonly ConceptEventDraft[] =>
  proposedFor(provenance.proposer, { file, lines }).map((item): ConceptEventDraft => ({
    concept: item.concept,
    kind: "exposure",
    origin: "model-proposed",
    task: provenance.task,
    file,
    source: "model-proposed",
    match: item.match,
  }));

export const changeEvents = (added: readonly AddedLine[], provenance: Provenance): readonly ConceptEventDraft[] =>
  [...groupByFile(added)].flatMap(([file, lines]) => {
    const found = recognizeCode({ file, lines }, provenance.packages ?? NO_PACKAGES);
    return found.length > 0 ? recognizedEvents(file, found, provenance) : proposalEvents(file, lines, provenance);
  });
