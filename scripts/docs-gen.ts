import { FOOTPRINT, type FootprintKind } from "../src/core/footprint.js";
import { DEFAULT_ITEMS } from "../src/defaults/items.js";
import { DEFAULTS_SECTION, DEFAULTS_TEXT } from "./defaults-text.js";
import { FAILURE_MODES, type FailureMode } from "./failure-modes.js";
import { FOOTPRINT_TEXT, type Lang, SECTION_TEXT } from "./footprint-text.js";

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

export const missingTests = (
  modes: readonly FailureMode[],
  read: (file: string) => string | undefined,
): readonly string[] =>
  modes
    .filter((mode) => {
      const source = read(mode.file);
      const call = new RegExp(`\\b(?:it|test)\\(\\s*"${escapeRegExp(mode.test)}"`);
      return source === undefined || !call.test(source);
    })
    .map((mode) => `${mode.file} has no test named "${mode.test}" (failure mode: ${mode.failure})`);

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
  { file: "README.md", marker: "footprint", render: () => renderFootprint("en") },
  { file: "README.pt-BR.md", marker: "footprint", render: () => renderFootprint("pt-BR") },
  { file: "README.es.md", marker: "footprint", render: () => renderFootprint("es") },
  { file: "SECURITY.md", marker: "footprint", render: () => renderFootprint("en") },
  { file: "README.md", marker: "defaults", render: () => renderDefaults("en") },
  { file: "README.pt-BR.md", marker: "defaults", render: () => renderDefaults("pt-BR") },
  { file: "README.es.md", marker: "defaults", render: () => renderDefaults("es") },
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
] as const;
