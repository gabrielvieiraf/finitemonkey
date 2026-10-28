import { isDeployContext, SSH_LINE, WORKFLOW } from "./detect.js";
import { findHosts } from "./hosts.js";
import { type InfraRisk, type PatternHit, RISK_SEVERITY, type RiskHit, type SourceFile } from "./types.js";

const GIT_PULL = /\bgit\s+pull\b/;
const BUILD =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\bdocker[-\s]compose\b[^\n]*(?:\bbuild\b|--build)|\bdocker\s+build\b/;
const HOST_KEY_OFF = /StrictHostKeyChecking[\s=]+no\b/i;
const IMAGE = /^\s*image:\s*["']?([^\s"'#]+)/;

const risk = (id: InfraRisk, file: string, line: number): RiskHit => ({
  id,
  severity: RISK_SEVERITY[id],
  file,
  line,
});

const linesOf = (text: string): readonly string[] => text.split(/\r?\n/);

const matching = (file: SourceFile, pattern: RegExp, from = 0): readonly number[] =>
  linesOf(file.text).flatMap((line, index) => (index >= from && pattern.test(line) ? [index + 1] : []));

const sshStart = (file: SourceFile, hits: readonly PatternHit[]): number | undefined => {
  const usesSsh = hits.some((hit) => hit.file === file.path && hit.pattern === "ssh-deploy");
  if (!usesSsh) return hits.some((hit) => hit.file === file.path && hit.pattern === "deploy-script") ? 0 : undefined;
  const index = linesOf(file.text).findIndex((line) => SSH_LINE.test(line));
  return index < 0 ? undefined : index;
};

const serverRisks = (file: SourceFile, hits: readonly PatternHit[]): readonly RiskHit[] => {
  const from = sshStart(file, hits);
  if (from === undefined) return [];
  return [
    ...matching(file, GIT_PULL, from).map((line) => risk("git-pull-on-server", file.path, line)),
    ...matching(file, BUILD, from).map((line) => risk("build-on-server", file.path, line)),
  ];
};

const waitsForCi = (text: string): boolean => /^\s*needs\s*:/m.test(text) || /^\s*workflow_run\s*:/m.test(text);

const ciRisks = (file: SourceFile): readonly RiskHit[] => {
  if (!WORKFLOW.test(file.path) || waitsForCi(file.text)) return [];
  const push = matching(file, /^\s*push\s*:|^on:\s*\[?[^\n]*\bpush\b/)[0];
  return push === undefined ? [] : [risk("deploy-without-ci", file.path, push)];
};

const contextRisks = (file: SourceFile, hits: readonly PatternHit[]): readonly RiskHit[] => {
  if (!isDeployContext(file, hits)) return [];
  const hostLines = [...new Set(findHosts([file]).map((found) => found.line))];
  return [
    ...serverRisks(file, hits),
    ...ciRisks(file),
    ...matching(file, HOST_KEY_OFF).map((line) => risk("host-key-unchecked", file.path, line)),
    ...hostLines.map((line) => risk("host-in-repo", file.path, line)),
  ];
};

const mutable = (reference: string): boolean => {
  if (reference.includes("${") || reference.includes("@sha256:")) return false;
  const name = reference.split("/").at(-1) ?? reference;
  return !name.includes(":") || name.endsWith(":latest");
};

const composeRisks = (file: SourceFile, hits: readonly PatternHit[]): readonly RiskHit[] => {
  if (!hits.some((hit) => hit.file === file.path && hit.pattern === "compose")) return [];
  return linesOf(file.text).flatMap((line, index) => {
    const reference = IMAGE.exec(line)?.[1];
    return reference !== undefined && mutable(reference) ? [risk("mutable-image-tag", file.path, index + 1)] : [];
  });
};

const dockerRisks = (file: SourceFile, hits: readonly PatternHit[]): readonly RiskHit[] => {
  if (!hits.some((hit) => hit.file === file.path && hit.pattern === "dockerfile")) return [];
  const users = linesOf(file.text).filter((line) => /^\s*USER\s+\S/i.test(line));
  const last = users.at(-1)?.trim().split(/\s+/)[1] ?? "root";
  if (!/^(root|0)(:|$)/.test(last)) return [];
  const from = matching(file, /^\s*FROM\s/i).at(-1) ?? 1;
  return [risk("root-container", file.path, from)];
};

export const findRisks = (files: readonly SourceFile[], hits: readonly PatternHit[]): readonly RiskHit[] =>
  files.flatMap((file) => [...contextRisks(file, hits), ...composeRisks(file, hits), ...dockerRisks(file, hits)]);
