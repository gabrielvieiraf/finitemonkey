import { createHash } from "node:crypto";

const MAX_SHINGLES = 64;
const SHINGLE_HASH = 6;

const words = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);

const hashed = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex").slice(0, SHINGLE_HASH);

export const promptFingerprint = (text: string): readonly string[] => {
  const list = words(text);
  const shingles = list.length < 2 ? list : list.slice(1).map((word, index) => `${list[index] ?? ""} ${word}`);
  return [...new Set(shingles.map(hashed))].slice(0, MAX_SHINGLES);
};

export const similarity = (left: readonly string[], right: readonly string[]): number => {
  if (left.length === 0 || right.length === 0) return 0;
  const set = new Set(left);
  const shared = right.filter((item) => set.has(item)).length;
  return shared / (set.size + right.length - shared);
};
