import { toPosixPath } from "../core/posix-path.js";
import type { SecretFinding } from "./engine.js";
import { sha256Hex } from "./fingerprint.js";
import type { Severity } from "./rules/types.js";

export interface LocatedFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: Severity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly fingerprint: string;
  readonly tail: string;
  readonly commit?: string;
}

export const findingId = (ruleId: string, file: string, fingerprint: string): string =>
  `fm-${sha256Hex(`${ruleId}\u0000${file}\u0000${fingerprint}`).slice(0, 16)}`;

export const locate = (finding: SecretFinding, rawFile: string, line: number, commit?: string): LocatedFinding => {
  const file = toPosixPath(rawFile);
  return {
    id: findingId(finding.ruleId, file, finding.fingerprint),
    ruleId: finding.ruleId,
    severity: finding.severity,
    file,
    line,
    column: finding.column,
    fingerprint: finding.fingerprint,
    tail: finding.tail,
    ...(commit === undefined ? {} : { commit }),
  };
};

export const whereOf = (finding: Pick<LocatedFinding, "file" | "line">): string =>
  `${finding.file}:${String(finding.line)}`;
