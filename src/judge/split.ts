export type ClaimSplitter = (text: string) => readonly string[] | undefined;

const ABBREVIATIONS = /\b(?:et al|e\.g|i\.e|vs|p|pp|cf|Dr|Mr|Ms|Fig|No|n|Sr|Jr)\.$/i;

const plainLine = (line: string): string =>
  line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/^\|.*\|$/, (row) => row.replace(/\|/g, " "))
    .trim();

const paragraphs = (text: string): readonly string[] => {
  const blocks: string[] = [];
  let fenced = false;
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) blocks.push(current.join(" "));
    current = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      flush();
      continue;
    }
    const line = fenced ? "" : plainLine(raw);
    if (line === "" || /^[-:| ]+$/.test(line)) flush();
    else current.push(line);
  }
  flush();
  return blocks;
};

const sentencesOf = (paragraph: string): readonly string[] => {
  const pieces = paragraph.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"“([])/u);
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last !== undefined && ABBREVIATIONS.test(last)) merged[merged.length - 1] = `${last} ${piece}`;
    else merged.push(piece);
  }
  return merged.map((sentence) => sentence.trim()).filter((sentence) => sentence !== "");
};

export const sentenceSplitter: ClaimSplitter = (text) => paragraphs(text).flatMap(sentencesOf);

export const splitClaims = (text: string, proposer: ClaimSplitter | undefined): readonly string[] => {
  const proposed = proposer?.(text);
  const sentences = proposed === undefined || proposed.length === 0 ? paragraphs(text).flatMap(sentencesOf) : proposed;
  return [...new Set(sentences.map((sentence) => sentence.replace(/\s+/g, " ").trim()).filter((item) => item !== ""))];
};
