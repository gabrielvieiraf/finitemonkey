import { isRecord } from "../core/parsed.js";
import { withoutCarriageReturn } from "../core/posix-path.js";
import { parseYaml } from "../core/yaml/parse.js";

const FENCE = /^\s*(```|~~~)/;
const IMPORT = /(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w.~-][\w./~-]*)/g;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

export const proseLines = (text: string): readonly { readonly line: number; readonly text: string }[] => {
  const out: { line: number; text: string }[] = [];
  let fenced = false;
  const body = FRONTMATTER.exec(text);
  const skip = body === null ? 0 : body[0].split("\n").length - 1;
  for (const [index, raw] of text.split("\n").entries()) {
    if (index < skip) continue;
    const line = withoutCarriageReturn(raw);
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) out.push({ line: index + 1, text: line });
  }
  return out;
};

const withoutCodeSpans = (line: string): string => line.replace(/`[^`]*`/g, " ");

export const importsOf = (text: string): readonly string[] =>
  proseLines(text).flatMap(({ text: line }) =>
    [...withoutCodeSpans(line).matchAll(IMPORT)]
      .map((match) => (match[1] ?? "").replace(/[.,;:)]+$/, ""))
      .filter((target) => target.includes(".") || target.includes("/")),
  );

const globList = (value: unknown): readonly string[] => {
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  return Array.isArray(value) ? value.flatMap((item: unknown) => globList(item)) : [];
};

export const frontmatterGlobs = (text: string): readonly string[] => {
  const block = FRONTMATTER.exec(text)?.[1];
  if (block === undefined) return [];
  const parsed = parseYaml(block);
  return parsed.ok && isRecord(parsed.value) ? globList(parsed.value["paths"]) : [];
};
