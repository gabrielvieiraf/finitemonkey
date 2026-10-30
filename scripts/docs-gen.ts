import { fileURLToPath } from "node:url";

import { FOOTPRINT, type FootprintKind } from "../src/core/footprint.js";
import { DEFAULT_ITEMS } from "../src/defaults/items.js";
import { type GuardFailureMode, guardFailureModes } from "../src/hooks/failure-modes.js";
import { DEFAULTS_SECTION, DEFAULTS_TEXT } from "./defaults-text.js";
import { readEvidence, renderEvidence } from "./evidence-text.js";
import { FAILURE_MODES, type FailureMode } from "./failure-modes.js";
import { FOOTPRINT_TEXT, type Lang, SECTION_TEXT } from "./footprint-text.js";
import { ATTACKERS, COMPONENTS, OUTCOMES, type Threat, THREATS } from "./threat-model.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const KIND_ORDER: readonly FootprintKind[] = ["reads", "writes", "sends"];

const cell = (text: string): string => text.replaceAll("|", "\\|");

export const renderFootprint = (lang: Lang, level = "##"): string => {
  const text = SECTION_TEXT[lang];
  const rows = KIND_ORDER.flatMap((kind) =>
    FOOTPRINT.filter((entry) => entry.kind === kind).map((entry) => {
      const targets = entry.targets.map((target) => `\`${target}\``).join(", ");
      return `| ${text.kinds[kind]} | ${cell(targets)} | ${cell(FOOTPRINT_TEXT[entry.id][lang])} |`;
    }),
  );
  return [
    `${level} ${text.heading}`,
    "",
    text.intro,
    "",
    `| | ${text.what} | ${text.why} |`,
    "|---|---|---|",
    ...rows,
  ].join("\n");
};

export const renderDefaults = (lang: Lang): string => {
  const section = DEFAULTS_SECTION[lang];
  return [
    `## ${section.heading}`,
    "",
    section.intro,
    "",
    `| ${section.columns.join(" | ")} |`,
    "|---|---|---|",
    ...DEFAULT_ITEMS.map((item) => {
      const text = DEFAULTS_TEXT[item][lang];
      return `| \`${item}\` | ${cell(text.what)} | ${cell(text.evidence)} |`;
    }),
  ].join("\n");
};

export const renderFailureModes = (modes: readonly FailureMode[]): string =>
  [
    "| Failure | Cause | Mitigation | Proving test |",
    "|---|---|---|---|",
    ...modes.map(
      (mode) =>
        `| ${cell(mode.failure)} | ${cell(mode.cause)} | ${cell(mode.mitigation)} | \`${mode.file}\`: "${cell(mode.test)}" |`,
    ),
  ].join("\n");

const MODE_TEXT: Readonly<Record<GuardFailureMode["mode"], string>> = {
  closed:
    "closed: when it cannot run, the action is blocked with the reason; at `Stop` the gate holds once and then records not run",
  open: "open: when it cannot run, the action goes through and `guard_failed_open` is logged",
};

export const renderGuardFailureModes = (modes: readonly GuardFailureMode[]): string =>
  [
    "Generated from `GUARD_SETS` in `src/hooks/handlers.ts`. Guards that prevent damage fail closed; advisory guards fail open.",
    "",
    "| Guard | Failure mode |",
    "|---|---|",
    ...modes.map((mode) => `| \`${mode.guard}\` | ${MODE_TEXT[mode.mode]} |`),
  ].join("\n");

const markers = (marker: string): readonly [string, string] => [
  `<!-- generated:${marker}:start -->`,
  `<!-- generated:${marker}:end -->`,
];

export const replaceBetween = (text: string, marker: string, content: string): string | undefined => {
  const [open, close] = markers(marker);
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start < 0 || end < start) return undefined;
  return `${text.slice(0, start + open.length)}\n${content}\n${text.slice(end)}`;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasTest = (source: string | undefined, name: string): boolean =>
  source !== undefined && new RegExp(`\\b(?:it|test)\\(\\s*"${escapeRegExp(name)}"`).test(source);

export const missingTests = (
  modes: readonly FailureMode[],
  read: (file: string) => string | undefined,
): readonly string[] =>
  modes
    .filter((mode) => !hasTest(read(mode.file), mode.test))
    .map((mode) => `${mode.file} has no test named "${mode.test}" (failure mode: ${mode.failure})`);

export const threatProblems = (
  threats: readonly Threat[],
  read: (file: string) => string | undefined,
  exists: (path: string) => boolean,
): readonly string[] =>
  threats.flatMap((threat) => {
    const where = `threat model: ${threat.threat}`;
    const code = threat.code.filter((path) => !exists(path)).map((path) => `${path} does not exist (${where})`);
    const { proof } = threat;
    if (proof === undefined) return threat.outcome === "not covered" ? code : [...code, `${where} names no test`];
    if (threat.outcome === "not covered") return [...code, `${where} is not covered but names a test`];
    return hasTest(read(proof.file), proof.test)
      ? code
      : [...code, `${proof.file} has no test named "${proof.test}" (${where})`];
  });

const proofCell = (threat: Threat): string =>
  threat.proof === undefined ? "not covered" : `\`${threat.proof.file}\`: "${threat.proof.test}"`;

const threatRow = (threat: Threat): string =>
  [
    threat.attacker,
    threat.threat,
    `**${threat.outcome}**`,
    threat.mechanism,
    threat.code.map((path) => `[\`${path}\`](../${path})`).join(", "),
    proofCell(threat),
  ]
    .map(cell)
    .join(" | ");

export const renderThreatModel = (threats: readonly Threat[]): string => {
  const sections = COMPONENTS.flatMap((component) => [
    "",
    `### ${component}`,
    "",
    "| Attacker | Threat | Outcome | Mechanism | Code | Proving test |",
    "|---|---|---|---|---|---|",
    ...threats.filter((threat) => threat.component === component).map((threat) => `| ${threatRow(threat)} |`),
  ]);
  const coverage = ATTACKERS.map((attacker) => {
    const counts = OUTCOMES.map((outcome) =>
      String(threats.filter((threat) => threat.attacker === attacker && threat.outcome === outcome).length),
    );
    return `| ${attacker} | ${counts.join(" | ")} |`;
  });
  return [
    "### Coverage by attacker",
    "",
    `| Attacker | ${OUTCOMES.join(" | ")} |`,
    `|---|${OUTCOMES.map(() => "---").join("|")}|`,
    ...coverage,
    ...sections,
  ].join("\n");
};

const NO_NETWORK_CLAIMS: readonly RegExp[] = [
  /network:\s*none/i,
  /\bno network\b/i,
  /\bno network (?:calls?|requests?|access)\b/i,
  /\bnever (?:touches|uses|calls) the network\b/i,
  /\boffline only\b/i,
  /\brede:\s*nenhuma/i,
  /\bsem rede\b/i,
  /\bnenhuma chamada de rede\b/i,
  /\bred:\s*ninguna/i,
  /\bsin red\b/i,
  /\bninguna llamada de red\b/i,
];

export const forbiddenPhrases = (text: string, hosts: readonly string[]): readonly string[] =>
  hosts.length === 0 ? [] : NO_NETWORK_CLAIMS.flatMap((pattern) => text.match(pattern) ?? []);

export const BLOCKS: readonly { readonly file: string; readonly marker: string; readonly render: () => string }[] = [
  { file: "docs/FAILURE-MODES.md", marker: "failure-modes", render: () => renderFailureModes(FAILURE_MODES) },
  { file: "docs/THREAT-MODEL.md", marker: "threat-model", render: () => renderThreatModel(THREATS) },
  { file: "README.md", marker: "footprint", render: () => renderFootprint("en") },
  { file: "README.pt-BR.md", marker: "footprint", render: () => renderFootprint("pt-BR") },
  { file: "README.es.md", marker: "footprint", render: () => renderFootprint("es") },
  { file: "SECURITY.md", marker: "footprint", render: () => renderFootprint("en") },
  { file: "SECURITY.md", marker: "guard-failure-modes", render: () => renderGuardFailureModes(guardFailureModes()) },
  { file: "README.md", marker: "defaults", render: () => renderDefaults("en") },
  { file: "README.pt-BR.md", marker: "defaults", render: () => renderDefaults("pt-BR") },
  { file: "README.es.md", marker: "defaults", render: () => renderDefaults("es") },
  { file: "README.md", marker: "evidence", render: () => renderEvidence("en", readEvidence(ROOT)) },
  { file: "README.pt-BR.md", marker: "evidence", render: () => renderEvidence("pt-BR", readEvidence(ROOT)) },
  { file: "README.es.md", marker: "evidence", render: () => renderEvidence("es", readEvidence(ROOT)) },
];

export const CLAIM_FILES = [
  "README.md",
  "README.pt-BR.md",
  "README.es.md",
  "SECURITY.md",
  "llms.txt",
  "llms.pt-BR.txt",
  "llms.es.txt",
  "docs/AGENT-SETUP.md",
  "docs/AGENT-SETUP.pt-BR.md",
  "docs/AGENT-SETUP.es.md",
  "docs/faq.md",
  "docs/faq.pt-BR.md",
  "docs/faq.es.md",
  "docs/THREAT-MODEL.md",
] as const;
