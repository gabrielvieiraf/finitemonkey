import type { Runtime } from "../../core/runtime.js";
import type { Repo } from "../repo.js";
import { blobText } from "./inputs.js";
import { normalizeLine } from "./lines.js";
import type { Finding, MergeInputs } from "./types.js";

const START = /<!--\s*generated:([\w.-]+):start\s*-->/;
const END = /<!--\s*generated:([\w.-]+):end\s*-->/;

export interface BlockLines {
  readonly inside: ReadonlySet<string>;
  readonly outside: ReadonlySet<string>;
}

export const blockLines = (text: string | undefined): BlockLines => {
  const inside = new Set<string>();
  const outside = new Set<string>();
  let open: string | undefined;
  for (const raw of (text ?? "").split("\n")) {
    const line = normalizeLine(raw);
    if (open === undefined) {
      open = START.exec(raw)?.[1];
      if (open === undefined && line !== "") outside.add(line);
    } else if (END.exec(raw)?.[1] === open) open = undefined;
    else if (line !== "") inside.add(line);
  }
  return { inside, outside };
};

const revsOf = (inputs: MergeInputs): readonly string[] => [inputs.base, inputs.ours, inputs.theirs, inputs.result];

export const withoutGeneratedBlocks = (
  runtime: Runtime,
  repo: Repo,
  inputs: MergeInputs,
  findings: readonly Finding[],
): readonly Finding[] => {
  const cache = new Map<string, readonly BlockLines[]>();
  const linesOf = (file: string): readonly BlockLines[] => {
    const known = cache.get(file);
    if (known !== undefined) return known;
    const fresh = revsOf(inputs).map((rev) => blockLines(blobText(runtime, repo, rev, file)));
    cache.set(file, fresh);
    return fresh;
  };
  return findings.filter((finding) => {
    const revs = linesOf(finding.file);
    const generated = revs.some((rev) => rev.inside.has(finding.text));
    const handWritten = revs.some((rev) => rev.outside.has(finding.text));
    return !generated || handWritten;
  });
};
