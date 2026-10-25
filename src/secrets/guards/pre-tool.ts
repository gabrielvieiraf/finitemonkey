import { relative } from "node:path";

import type { AbsolutePath } from "../../core/brand.js";
import { optionalString } from "../../core/parsed.js";
import type { HookDecision, HookHandler, HookInput } from "../../hooks/handlers.js";
import type { Translate } from "../../i18n/translate.js";
import { scanText } from "../engine.js";
import { scanStaged } from "../scan.js";
import { type BashFinding, bashFindings, commitIntent } from "./bash-rules.js";
import { describeFindings, lineWhere, type Located } from "./describe.js";
import { isSensitivePath } from "./paths.js";
import { segmentsOf } from "./shell.js";
import { toolInput, toolName, writtenTexts } from "./tool-input.js";

const ALLOW: HookDecision = { kind: "allow" };

const relativeFile = (cwd: AbsolutePath, file: string): string => {
  if (file === "") return file;
  const rel = relative(cwd, file).split("\\").join("/");
  return rel.startsWith("..") || rel === "" ? file : rel;
};

const writeDecision = (input: HookInput, tool: string): HookDecision => {
  const { t } = input;
  for (const written of writtenTexts(tool, toolInput(input.payload))) {
    const file = relativeFile(input.cwd, written.file);
    const found = scanText(written.text, { path: file });
    if (found.length === 0) continue;
    const items: Located[] = found.map((finding) => ({
      ruleId: finding.ruleId,
      where: written.whole
        ? t("secrets.where.file", { file, line: finding.line, column: finding.column })
        : t("secrets.where.new_text", { file, line: finding.line }),
    }));
    return { kind: "block", reason: t("secrets.block.write", { file, found: describeFindings(t, items) }) };
  }
  return ALLOW;
};

const bashMessage = (t: Translate, finding: BashFinding): string => {
  switch (finding.kind) {
    case "read":
      return t("secrets.block.read", { target: finding.target });
    case "env-dump":
      return t("secrets.block.env_dump", { command: finding.command });
    case "person-only":
      return t("secrets.block.person_only", { command: finding.command });
  }
};

const commitDecision = (input: HookInput, includeUnstaged: boolean): HookDecision => {
  const staged = scanStaged(input.runtime, input.cwd, includeUnstaged);
  if (!staged.ok || staged.value.length === 0) return ALLOW;
  const items = staged.value.map((finding) => ({
    ruleId: finding.ruleId,
    where: input.t("secrets.where.file", { file: finding.file, line: finding.line, column: finding.column }),
  }));
  return { kind: "block", reason: input.t("secrets.block.commit", { found: describeFindings(input.t, items) }) };
};

const bashDecision = (input: HookInput): HookDecision => {
  const command = optionalString(toolInput(input.payload), "command") ?? "";
  if (command === "") return ALLOW;
  const segments = segmentsOf(command);
  const [first] = bashFindings(command, segments);
  if (first !== undefined) return { kind: "block", reason: bashMessage(input.t, first) };
  const found = scanText(command);
  if (found.length > 0) {
    const items = found.map((finding) => ({ ruleId: finding.ruleId, where: lineWhere(input.t, finding) }));
    return { kind: "block", reason: input.t("secrets.block.bash", { found: describeFindings(input.t, items) }) };
  }
  const commit = commitIntent(segments);
  return commit === undefined ? ALLOW : commitDecision(input, commit.includeUnstaged);
};

const readDecision = (input: HookInput): HookDecision => {
  const inputs = toolInput(input.payload);
  const target = optionalString(inputs, "file_path") ?? optionalString(inputs, "path") ?? "";
  if (target === "" || !isSensitivePath(target)) return ALLOW;
  return { kind: "block", reason: input.t("secrets.block.read", { target: relativeFile(input.cwd, target) }) };
};

const WRITERS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SHELLS = new Set(["Bash", "PowerShell"]);
const READS = new Set(["Read", "Grep"]);

export const secretsPreToolUse: HookHandler = (input) => {
  const tool = toolName(input.payload);
  if (WRITERS.has(tool)) return writeDecision(input, tool);
  if (SHELLS.has(tool)) return bashDecision(input);
  if (READS.has(tool)) return readDecision(input);
  return ALLOW;
};
