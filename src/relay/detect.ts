import { type ImportedPackage, importedPackages } from "./imports.js";

export const RELAY_MARKERS = ["chat", "placeholder", "missing_import", "own_output"] as const;

export type RelayMarker = (typeof RELAY_MARKERS)[number];

export interface PastedBlock {
  readonly text: string;
  readonly lines: number;
}

export interface RelayFinding {
  readonly blocks: number;
  readonly lines: number;
  readonly markers: readonly RelayMarker[];
  readonly missing: readonly string[];
  readonly placeholders: readonly string[];
}

const PASTED = /<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content>/gi;
const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const MIN_LINES = 4;
const MIN_CHARS = 800;

const CHAT = [
  /^\s*(?:chatgpt|gpt-?\d|gemini|copilot|claude|assistant|bard|perplexity)\s*(?:said|disse|dijo)?\s*:/im,
  /^\s*(?:you said|voc[eê] disse|dijiste|user)\s*:/im,
  /\bcopy code\b|\bcopiar c[oó]digo\b/i,
  /\bas an ai (?:language )?model\b|\bcomo (?:um|una?) (?:modelo|ia)\b/i,
  /^\s*(?:sure|certainly|claro|com certeza|por supuesto)[!,.]\s+(?:here|aqui|aquí)/im,
];

const PLACEHOLDER =
  /\b(?:YOUR_[A-Z_]+|your[-_]?api[-_]?key|<your[-_ ][^>]+>|path\/to\/[\w./-]+|example\.com)\b|\/\/\s*\.\.\.|#\s*\.\.\.|\.\.\.\s*(?:rest of|resto d)|\brest of (?:the )?code\b|\bTODO: implement\b/gi;

const lineCount = (text: string): number => text.split("\n").filter((line) => line.trim() !== "").length;

export const pastedBlocks = (prompt: string): readonly PastedBlock[] => {
  const explicit = [...prompt.matchAll(PASTED), ...prompt.matchAll(FENCE)].map((match) => match[1] ?? "");
  const blocks = explicit.length > 0 ? explicit : [prompt];
  return blocks
    .map((text) => ({ text, lines: lineCount(text) }))
    .filter((block) => explicit.length > 0 || block.lines >= MIN_LINES || block.text.length >= MIN_CHARS);
};

const isMissing = (pkg: ImportedPackage, manifests: string): boolean => {
  const escaped = pkg.name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const pattern =
    pkg.language === "js"
      ? new RegExp(`["']${escaped}["']\\s*:`)
      : new RegExp(`(?:^|["'\\s])${escaped.replace(/[-_]/g, "[-_]")}(?:\\s|[=<>~\\[;"',]|$)`, "im");
  return !pattern.test(manifests);
};

export interface ProjectFacts {
  readonly manifests: string;
  readonly hasJs: boolean;
  readonly hasPython: boolean;
  readonly ownOutput: readonly string[];
}

export const detectRelay = (prompt: string, facts: ProjectFacts): RelayFinding | undefined => {
  const blocks = pastedBlocks(prompt);
  if (blocks.length === 0) return undefined;
  const text = blocks.map((block) => block.text).join("\n");
  const placeholders = [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[0]))].slice(0, 5);
  const missing = importedPackages(text)
    .filter((pkg) => (pkg.language === "js" ? facts.hasJs : facts.hasPython) && isMissing(pkg, facts.manifests))
    .map((pkg) => pkg.name);
  const markers: RelayMarker[] = [
    ...(CHAT.some((pattern) => pattern.test(text)) ? (["chat"] as const) : []),
    ...(placeholders.length > 0 ? (["placeholder"] as const) : []),
    ...(missing.length > 0 ? (["missing_import"] as const) : []),
    ...(facts.ownOutput.some((line) => line.length >= 20 && text.includes(line)) ? (["own_output"] as const) : []),
  ];
  if (markers.length === 0) return undefined;
  return {
    blocks: blocks.length,
    lines: blocks.reduce((sum, block) => sum + block.lines, 0),
    markers,
    missing,
    placeholders,
  };
};
