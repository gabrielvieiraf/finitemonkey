import { scanRepo } from "../appsec/scan.js";
import { auditRepo, CI_AUDIT_CHECK } from "../ci/audit/audit.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { scanPath } from "../secrets/scan.js";
import { type Finding, SECRETS_CHECK } from "./baseline.js";

export interface FindingSource {
  readonly check: string;
  readonly scan: (runtime: Runtime, root: AbsolutePath) => readonly Finding[];
}

const secretsSource: FindingSource = {
  check: SECRETS_CHECK,
  scan: (runtime, root) => {
    const scanned = scanPath(runtime, root, ".");
    return scanned.ok
      ? scanned.value.map((item) => ({
          id: item.id,
          check: SECRETS_CHECK,
          rule: item.ruleId,
          file: item.file,
          line: item.line,
          fingerprint: item.fingerprint,
        }))
      : [];
  },
};

const appsecSource: FindingSource = { check: "appsec", scan: scanRepo };

const ciAuditSource: FindingSource = {
  check: CI_AUDIT_CHECK,
  scan: (runtime, root) => auditRepo(runtime, root).findings,
};

export const FINDING_SOURCES: readonly FindingSource[] = [secretsSource, appsecSource, ciAuditSource];

export const findFinding = (
  runtime: Runtime,
  root: AbsolutePath,
  id: string,
  sources: readonly FindingSource[] = FINDING_SOURCES,
): Finding | undefined => {
  for (const source of sources) {
    const found = source.scan(runtime, root).find((item) => item.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
};
