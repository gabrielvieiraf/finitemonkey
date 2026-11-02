import { remoteUrl } from "./http.js";

export type CodeEffect = "destroy" | "write";

export interface CodeCall {
  readonly effect: CodeEffect;
  readonly url: string;
}

const QUOTED_URL = String.raw`(?:URI\(\s*)?[\x60'"](https?:\/\/[^\x60'"]+)`;

const PATTERNS: Readonly<Record<CodeEffect, RegExp>> = {
  destroy: new RegExp(String.raw`\.delete\(\s*${QUOTED_URL}|method\s*[:=]\s*[\x60'"]DELETE[\x60'"]`, "gi"),
  write: new RegExp(
    String.raw`\.(?:post|put|patch|post_form)\(\s*${QUOTED_URL}|method\s*[:=]\s*[\x60'"](?:POST|PUT|PATCH)[\x60'"]`,
    "gi",
  ),
};

const ANY_URL = /https?:\/\/[^\s'"`)]+/g;

const nearestUrl = (code: string, at: number): string | undefined => {
  let best: { url: string; distance: number } | undefined;
  for (const match of code.matchAll(ANY_URL)) {
    const distance = Math.abs(match.index - at);
    if (best === undefined || distance < best.distance) best = { url: match[0], distance };
  }
  return best?.url;
};

const callsOf = (code: string, effect: CodeEffect): readonly CodeCall[] =>
  [...code.matchAll(PATTERNS[effect])].flatMap((match) => {
    const url = match[1] ?? nearestUrl(code, match.index);
    return url !== undefined && remoteUrl(url) ? [{ effect, url }] : [];
  });

export const codeCall = (code: string): CodeCall | undefined => {
  const [destroy] = callsOf(code, "destroy");
  if (destroy !== undefined) return destroy;
  const [write] = callsOf(code, "write");
  return write;
};
